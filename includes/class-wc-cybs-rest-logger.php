<?php

defined( 'ABSPATH' ) || exit;

final class WC_Cybs_REST_Logger {
	private $enabled;
	private $logger;

	public function __construct( $enabled ) {
		$this->enabled = wc_string_to_bool( $enabled );
		$this->logger  = function_exists( 'wc_get_logger' ) ? wc_get_logger() : null;
	}

	public function log( $level, $message, $context = array() ) {
		if ( ! $this->enabled || ! $this->logger ) {
			return;
		}
		$allowed_level = in_array( $level, array( 'debug', 'info', 'notice', 'warning', 'error', 'critical' ), true ) ? $level : 'info';
		$payload       = empty( $context ) ? '' : ' ' . wp_json_encode( WC_Cybs_REST_Sanitizer::sanitize( $context ), JSON_UNESCAPED_SLASHES );
		$this->logger->log(
			$allowed_level,
			(string) $message . $payload,
			array( 'source' => 'cybersource-rest' )
		);
	}
}
