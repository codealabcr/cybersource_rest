(function ($) {
	'use strict';

	if (!window.wcCybsRest) return;
	var config = window.wcCybsRest;

	function api(path, data) {
		return fetch(config.apiBase + '/' + path, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {'Content-Type': 'application/json', 'X-WP-Nonce': config.nonce},
			body: JSON.stringify(data)
		}).then(function (response) {
			return response.json().then(function (json) {
				if (!response.ok) throw new Error(json.message || config.messages.failed);
				return json;
			});
		});
	}

	function deviceData() {
		return {
			httpAcceptBrowserValue: navigator.userAgent,
			httpAcceptContent: 'application/json,text/html,application/xhtml+xml',
			httpBrowserColorDepth: String(screen.colorDepth || 24),
			httpBrowserJavaEnabled: String(!!navigator.javaEnabled && navigator.javaEnabled()),
			httpBrowserJavaScriptEnabled: 'true',
			httpBrowserLanguage: navigator.language || '',
			httpBrowserScreenHeight: String(screen.height || ''),
			httpBrowserScreenWidth: String(screen.width || ''),
			httpBrowserTimeDifference: String(new Date().getTimezoneOffset()),
			userAgentBrowserValue: navigator.userAgent
		};
	}

	function formatExpiry(value) {
		var digits = String(value || '').replace(/\D/g, '').slice(0, 4);
		if (digits.length <= 2) return digits;
		return digits.slice(0, 2) + ' / ' + digits.slice(2);
	}

	function parseExpiry(value) {
		var digits = String(value || '').replace(/\D/g, '');
		if (digits.length !== 4) return null;
		var month = digits.slice(0, 2);
		var year = '20' + digits.slice(2, 4);
		if (Number(month) < 1 || Number(month) > 12) return null;
		var now = new Date();
		if ((Number(year) * 100 + Number(month)) < (now.getFullYear() * 100 + now.getMonth() + 1)) return null;
		return {month: month, year: year, digits: digits};
	}

	function normalizeAmount(value) {
		var text = String(value || '').replace(/\s/g, '');
		var thousand = String(config.thousandSeparator || ',');
		var decimal = String(config.decimalSeparator || '.');
		if (thousand) text = text.split(thousand).join('');
		if (decimal && decimal !== '.') text = text.split(decimal).join('.');
		text = text.replace(/[^0-9.-]/g, '');
		var amount = Number(text);
		if (!isFinite(amount) || amount <= 0) return '';
		return amount.toFixed(Number(config.priceDecimals || 2));
	}

	function checkoutTransaction() {
		var displayed = $('.order-total .woocommerce-Price-amount, .order-total .amount').last().text();
		var amount = normalizeAmount(displayed) || normalizeAmount(config.checkoutAmount);
		return {amount: amount, currency: config.currency};
	}

	function collectDevice(url, jwt) {
		return new Promise(function (resolve) {
			var iframe = document.createElement('iframe');
			iframe.name = 'cybs-ddc-' + Date.now();
			iframe.className = 'cybs-hidden-frame';
			iframe.title = '3-D Secure device data';
			var form = document.createElement('form');
			form.method = 'POST'; form.target = iframe.name; form.action = url;
			var input = document.createElement('input');
			input.type = 'hidden'; input.name = 'JWT'; input.value = jwt;
			form.appendChild(input); document.body.appendChild(iframe); document.body.appendChild(form);
			var done = false;
			function finish() { if (done) return; done = true; window.removeEventListener('message', listener); form.remove(); iframe.remove(); resolve(); }
			function listener(event) { if (event.origin === config.ddcOrigin) finish(); }
			window.addEventListener('message', listener, false);
			form.submit();
			setTimeout(finish, 10000);
		});
	}

	function challenge(url, jwt, fallbackTransactionId) {
		return new Promise(function (resolve, reject) {
			var overlay = document.createElement('div'); overlay.className = 'cybs-challenge-overlay';
			overlay.innerHTML = '<div class="cybs-challenge-dialog" role="dialog" aria-modal="true"><p>' + config.messages.challenge + '</p><iframe name="cybs-step-up" title="3-D Secure" width="500" height="600"></iframe><button type="button" class="button cybs-challenge-cancel">Cancelar</button></div>';
			var form = document.createElement('form'); form.method = 'POST'; form.target = 'cybs-step-up'; form.action = url; form.className = 'cybs-step-up-form';
			var input = document.createElement('input'); input.type = 'hidden'; input.name = 'JWT'; input.value = jwt; form.appendChild(input);
			document.body.appendChild(overlay); document.body.appendChild(form);
			var timer = setTimeout(function () { cleanup(); reject(new Error(config.messages.failed)); }, 5 * 60 * 1000);
			function cleanup() { clearTimeout(timer); window.removeEventListener('message', listener); form.remove(); overlay.remove(); }
			function listener(event) {
				if (event.origin !== window.location.origin || !event.data || event.data.type !== 'cybs-3ds-complete') return;
				var id = event.data.transactionId || fallbackTransactionId; cleanup(); id ? resolve(id) : reject(new Error(config.messages.failed));
			}
			window.addEventListener('message', listener, false);
			overlay.querySelector('.cybs-challenge-cancel').addEventListener('click', function () { cleanup(); reject(new Error(config.messages.failed)); });
			form.submit();
		});
	}

	function authenticate(card, billing, onStatus, transaction) {
		if (!config.enable3ds) return Promise.resolve('3ds-disabled');
		if (!card || !/^\d{12,19}$/.test(card.number || '') || !/^\d{2}$/.test(card.expirationMonth || '') || !/^\d{4}$/.test(card.expirationYear || '')) {
			return Promise.reject(new Error('Ingresa una fecha de vencimiento válida en formato MM / AA.'));
		}
		transaction = transaction || checkoutTransaction();
		var amount = normalizeAmount(transaction.amount);
		if (!amount || transaction.currency !== config.currency) {
			return Promise.reject(new Error('No fue posible determinar el total actual de la compra. Actualiza el checkout e intenta nuevamente.'));
		}
		var base = {
			number: card.number,
			expirationMonth: card.expirationMonth,
			expirationYear: card.expirationYear,
			checkoutBinding: config.checkoutBinding,
			deviceFingerprintId: config.deviceId,
			amount: amount,
			currency: config.currency
		};
		onStatus(config.messages.authenticating);
		return api('setup', base).then(function (setup) {
			return collectDevice(setup.deviceDataCollectionUrl, setup.accessToken).then(function () {
				return api('enroll', Object.assign({}, base, {referenceId: setup.referenceId, billing: billing, device: deviceData()}));
			});
		}).then(function (enroll) {
			if (enroll.authToken) return enroll.authToken;
			if (enroll.status !== 'PENDING_AUTHENTICATION') throw new Error(config.messages.failed);
			return challenge(enroll.stepUpUrl, enroll.accessToken, enroll.authenticationTransactionId).then(function (transactionId) {
				return api('validate', Object.assign({}, base, {authenticationTransactionId: transactionId}));
			}).then(function (validated) {
				if (!validated.authToken) throw new Error(config.messages.failed);
				return validated.authToken;
			});
		});
	}

	window.WCCybs3DS = {authenticate: authenticate, deviceData: deviceData, formatExpiry: formatExpiry, parseExpiry: parseExpiry, normalizeAmount: normalizeAmount, checkoutTransaction: checkoutTransaction, checkoutBinding: config.checkoutBinding};

	function classicCard() {
		var digits = ($('#cybs-card-number').val() || '').replace(/\D/g, '');
		var expiry = parseExpiry($('#cybs-card-expiry').val());
		return expiry ? {number: digits, expirationMonth: expiry.month, expirationYear: expiry.year} : null;
	}

	function classicBilling() {
		var value = function (name) {
			return $('[name="billing_' + name + '"]').val() || $('[name="shipping_' + name + '"]').val() || '';
		};
		return {first_name:value('first_name'), last_name:value('last_name'), address_1:value('address_1'), address_2:value('address_2'), city:value('city'), state:value('state'), postcode:value('postcode'), country:value('country'), email:value('email'), phone:value('phone')};
	}

	var processing = false;
	var verifiedAuthToken = '';
	function setClassicProcessing(active) {
		var form = $('form.checkout');
		var button = form.find('#place_order');
		if (!button.length) return;
		if (active) {
			if (!button.data('cybs-original-label')) button.data('cybs-original-label', button.text());
			button.prop('disabled', true).attr('aria-disabled', 'true').attr('aria-busy', 'true').addClass('cybs-authenticating').text(config.messages.authenticating);
			form.attr('aria-busy', 'true');
		} else {
			var original = button.data('cybs-original-label');
			if (original) button.text(original);
			button.prop('disabled', false).removeAttr('aria-disabled aria-busy').removeClass('cybs-authenticating');
			form.removeAttr('aria-busy');
		}
	}
	function ensureClassicAuthFields() {
		var form = $('form.checkout');
		if (!form.length) return;
		var authField = form.find('[name="cybs_auth_token"]');
		var bindingField = form.find('[name="cybs_checkout_binding"]');
		if (!authField.length) {
			form.append('<input type="hidden" name="cybs_auth_token" id="cybs-auth-token" />');
			authField = form.find('[name="cybs_auth_token"]');
		}
		if (!bindingField.length) {
			form.append('<input type="hidden" name="cybs_checkout_binding" id="cybs-checkout-binding" />');
			bindingField = form.find('[name="cybs_checkout_binding"]');
		}
		authField.val(verifiedAuthToken);
		bindingField.val(config.checkoutBinding);
	}
	$(document.body).on('input', '#cybs-card-expiry', function () {
		var formatted = formatExpiry(this.value);
		if (this.value !== formatted) this.value = formatted;
	});
	$(document.body).on('updated_checkout', function () {
		if (verifiedAuthToken) ensureClassicAuthFields();
		bindClassicCheckout();
		if (processing) setClassicProcessing(true);
	});
	$(document.body).on('checkout_error', function () {
		verifiedAuthToken = '';
		processing = false;
		setClassicProcessing(false);
		$('form.checkout').find('[name="cybs_auth_token"]').val('');
		$('#cybs-rest-status').text('');
	});
	function handleClassicCheckout() {
		if (!config.enable3ds) return true;
		var postedToken = $('form.checkout').find('[name="cybs_auth_token"]').val() || '';
		if (verifiedAuthToken || postedToken) {
			if (!verifiedAuthToken) verifiedAuthToken = postedToken;
			ensureClassicAuthFields();
			return true;
		}
		if (processing) return false;
		processing = true;
		setClassicProcessing(true);
		authenticate(classicCard(), classicBilling(), function (message) { $('#cybs-rest-status').text(message); }, checkoutTransaction())
			.then(function (token) { verifiedAuthToken = token; ensureClassicAuthFields(); processing = false; setClassicProcessing(false); $('#cybs-rest-status').text(''); $('form.checkout').trigger('submit'); })
			.catch(function (error) { processing = false; setClassicProcessing(false); $('#cybs-rest-status').text(''); $('.woocommerce-NoticeGroup-checkout').remove(); $('form.checkout').prepend('<div class="woocommerce-NoticeGroup woocommerce-NoticeGroup-checkout"><ul class="woocommerce-error"><li>' + $('<div>').text(error.message).html() + '</li></ul></div>'); $('html,body').animate({scrollTop:$('form.checkout').offset().top - 80}, 300); });
		return false;
	}

	function bindClassicCheckout() {
		var form = $('form.checkout');
		if (!form.length) return;
		var eventName = 'checkout_place_order_' + config.gatewayId;
		form.off(eventName + '.cybsRest').on(eventName + '.cybsRest', handleClassicCheckout);
	}

	$(bindClassicCheckout);
	$(document.body).on('init_checkout', bindClassicCheckout);
})(jQuery);
