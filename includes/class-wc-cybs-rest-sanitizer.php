<?php

defined( 'ABSPATH' ) || exit;

/**
 * Removes payment credentials and sensitive authentication material from logs.
 */
final class WC_Cybs_REST_Sanitizer {
	private const SENSITIVE_KEYS = array(
		'number', 'securitycode', 'cvv', 'cvc', 'pan', 'cardnumber',
		'access_token', 'accesstoken', 'jwt', 'signature', 'keyid', 'secretkey',
		'signedpares', 'responseaccesstoken', 'pareq', 'token', 'fluiddata',
		'cavv', 'xid', 'ucafauthenticationdata', 'credentialencrypted',
	);

	private const PERSONAL_KEYS = array(
		'firstname', 'lastname', 'address1', 'address2', 'email', 'phonenumber',
		'phone', 'postalcode', 'locality', 'ipaddress', 'useragentbrowservalue',
		'httpacceptbrowservalue',
	);

	public static function sanitize( $value, $key = '' ) {
		$normalized_key = strtolower( preg_replace( '/[^a-z0-9]/i', '', (string) $key ) );
		if ( in_array( $normalized_key, self::SENSITIVE_KEYS, true ) ) {
			if ( 'number' === $normalized_key || 'pan' === $normalized_key || 'cardnumber' === $normalized_key ) {
				return self::mask_card( is_scalar( $value ) ? (string) $value : '' );
			}
			return '[REDACTED]';
		}
		if ( in_array( $normalized_key, self::PERSONAL_KEYS, true ) ) {
			return '[REDACTED]';
		}

		if ( is_array( $value ) ) {
			$clean = array();
			foreach ( $value as $child_key => $child_value ) {
				$clean[ $child_key ] = self::sanitize( $child_value, (string) $child_key );
			}
			return $clean;
		}

		if ( is_object( $value ) ) {
			return self::sanitize( get_object_vars( $value ) );
		}

		if ( is_string( $value ) ) {
			// Last-resort protection for PAN-like sequences embedded in messages.
			return preg_replace_callback(
				'/(?<!\d)(?:\d[ -]?){12,19}(?!\d)/',
				static function ( $matches ) {
					return self::mask_card( $matches[0] );
				},
				$value
			);
		}

		return $value;
	}

	public static function mask_card( $number ) {
		$digits = preg_replace( '/\D+/', '', (string) $number );
		if ( strlen( $digits ) < 8 ) {
			return '[REDACTED]';
		}
		return substr( $digits, 0, 6 ) . str_repeat( '*', max( 4, strlen( $digits ) - 10 ) ) . substr( $digits, -4 );
	}
}
