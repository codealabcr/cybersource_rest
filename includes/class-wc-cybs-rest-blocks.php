<?php

defined( 'ABSPATH' ) || exit;

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

final class WC_Cybs_REST_Blocks extends AbstractPaymentMethodType {
	protected $name = 'cybersource_rest';
	private $gateway;

	public function initialize() {
		$this->settings = get_option( 'woocommerce_cybersource_rest_settings', array() );
		$this->gateway  = new WC_Gateway_Cybs_REST();
	}

	public function is_active() {
		return $this->gateway && $this->gateway->is_available();
	}

	public function get_payment_method_script_handles() {
		wp_register_script(
			'wc-cybs-rest-blocks',
			WC_CYBS_REST_URL . 'assets/js/blocks.js',
			array( 'wc-blocks-registry', 'wc-settings', 'wp-element', 'wp-html-entities' ),
			WC_CYBS_REST_VERSION,
			true
		);
		return array( 'wc-cybs-rest-blocks' );
	}

	public function get_payment_method_data() {
		return array(
			'title'       => $this->gateway->title,
			'description' => $this->gateway->description,
			'supports'    => array_filter( $this->gateway->supports, array( $this->gateway, 'supports' ) ),
			'frontend'    => $this->gateway->frontend_data(),
		);
	}
}
