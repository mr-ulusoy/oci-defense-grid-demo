output "game_url" {
  description = "Public URL for the Phaser game behind OCI Load Balancer."
  value       = "http://${oci_load_balancer_load_balancer.web.ip_address_details[0].ip_address}"
}

output "api_gateway_endpoint" {
  description = "API Gateway endpoint used by the browser HUD."
  value       = "https://${oci_apigateway_gateway.demo.hostname}"
}

output "private_api_load_balancer_ip" {
  description = "Private Load Balancer IP used by API Gateway."
  value       = local.api_lb_ip
}

output "app_instance_pool_id" {
  description = "Compute instance pool running the game and API backends."
  value       = oci_core_instance_pool.app.id
}

output "debug_bastion_public_ip" {
  description = "Public IP for the temporary SSH debug bastion, when enabled."
  value       = var.create_debug_bastion ? oci_core_instance.debug_bastion[0].public_ip : null
}

output "autoscaling_configuration_id" {
  description = "Autoscaling configuration attached to the app instance pool."
  value       = oci_autoscaling_auto_scaling_configuration.app.id
}

output "stream_ocid" {
  description = "OCI Streaming stream OCID for gameplay events."
  value       = oci_streaming_stream.events.id
}

output "raw_events_bucket" {
  description = "Object Storage bucket for raw gameplay event archives."
  value       = oci_objectstorage_bucket.raw_events.name
}

output "redis_live_players_endpoint" {
  description = "OCI Cache primary FQDN used for live player state, when enabled."
  value       = var.create_redis_cache ? oci_redis_redis_cluster.live_players[0].primary_fqdn : var.redis_host
}

output "autonomous_database_name" {
  description = "Autonomous Database display name for analytics tables."
  value       = var.create_autonomous_database ? oci_database_autonomous_database.demo[0].display_name : null
}

output "analytics_instance_url" {
  description = "Optional Oracle Analytics Cloud URL if create_analytics_instance is true."
  value       = var.create_analytics_instance ? oci_analytics_analytics_instance.demo[0].service_url : null
}
