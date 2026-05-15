data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_objectstorage_namespace" "namespace" {
  compartment_id = var.compartment_ocid
}

resource "random_id" "suffix" {
  byte_length = 3
}

locals {
  name_prefix             = "${var.project_name}-${random_id.suffix.hex}"
  vcn_cidr                = "10.42.0.0/16"
  public_cidr             = "10.42.10.0/24"
  private_cidr            = "10.42.20.0/24"
  api_base_url            = var.public_api_base_url != "" ? trimsuffix(var.public_api_base_url, "/") : "https://${oci_apigateway_gateway.demo.hostname}/api"
  api_lb_ip               = oci_load_balancer_load_balancer.api.ip_address_details[0].ip_address
  function_ingest_enabled = var.function_image != ""
  redis_host              = var.create_redis_cache ? oci_redis_redis_cluster.live_players[0].primary_fqdn : var.redis_host
  redis_port              = tostring(var.redis_port)
  redis_tls               = var.redis_tls ? "true" : "false"
  adb_low                 = var.create_autonomous_database ? oci_database_autonomous_database.demo[0].connection_strings[0].low : ""
  adb_host                = local.adb_low == "" ? "" : split(":", split("/", local.adb_low)[0])[0]
  adb_service             = local.adb_low == "" ? "" : split("/", local.adb_low)[1]
  adb_generated_connect_string = local.adb_low == "" ? "" : join("", [
    "(description=(retry_count=20)(retry_delay=3)",
    "(address=(protocol=tcps)(port=1522)(host=${local.adb_host}))",
    "(connect_data=(service_name=${local.adb_service}))",
    "(security=(ssl_server_dn_match=yes)))"
  ])
  adb_app_connect_string = var.adb_connect_string != "" ? var.adb_connect_string : local.adb_generated_connect_string
  adb_whitelisted_ips    = length(var.adb_whitelisted_ips) > 0 ? var.adb_whitelisted_ips : (var.adb_is_mtls_connection_required ? [] : ["${oci_core_nat_gateway.demo.nat_ip}/32"])
  app_user_data = base64encode(templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {
    app_repo_url       = var.app_repo_url
    app_git_ref        = var.app_git_ref
    api_base_url       = local.api_base_url
    api_gateway_name   = oci_apigateway_gateway.demo.display_name
    load_balancer_name = oci_load_balancer_load_balancer.web.display_name
    min_app_nodes      = var.instance_pool_min_size
    stream_ocid        = oci_streaming_stream.events.id
    stream_endpoint    = oci_streaming_stream.events.messages_endpoint
    bucket_name        = oci_objectstorage_bucket.raw_events.name
    namespace          = data.oci_objectstorage_namespace.namespace.namespace
    genai_endpoint     = var.oci_genai_endpoint
    genai_bearer_token = var.oci_genai_bearer_token
    genai_model        = var.oci_genai_model
    genai_compartment  = coalesce(var.oci_genai_compartment_ocid, var.compartment_ocid)
    event_ingest_mode  = local.function_ingest_enabled ? "oci-functions" : "vm-api"
    redis_host         = local.redis_host
    redis_port         = local.redis_port
    redis_tls          = local.redis_tls
    live_player_ttl    = tostring(var.live_player_ttl_seconds)
    adb_user           = var.adb_user
    adb_password       = var.adb_admin_password
    adb_connect_string = local.adb_app_connect_string
    region             = var.region
  }))
}

resource "oci_core_vcn" "demo" {
  cidr_block     = local.vcn_cidr
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-vcn"
  dns_label      = "ocidefense"
}

resource "oci_core_internet_gateway" "demo" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-igw"
  vcn_id         = oci_core_vcn.demo.id
}

resource "oci_core_nat_gateway" "demo" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-nat"
  vcn_id         = oci_core_vcn.demo.id
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-public-rt"
  vcn_id         = oci_core_vcn.demo.id

  route_rules {
    network_entity_id = oci_core_internet_gateway.demo.id
    destination       = "0.0.0.0/0"
  }
}

resource "oci_core_route_table" "private" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-private-rt"
  vcn_id         = oci_core_vcn.demo.id

  route_rules {
    network_entity_id = oci_core_nat_gateway.demo.id
    destination       = "0.0.0.0/0"
  }
}

resource "oci_core_security_list" "public_lb" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-public-lb-sl"
  vcn_id         = oci_core_vcn.demo.id

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 443
      max = 443
    }
  }

  dynamic "ingress_security_rules" {
    for_each = var.create_debug_bastion ? [1] : []

    content {
      protocol = "6"
      source   = var.debug_ssh_source_cidr
      tcp_options {
        min = 22
        max = 22
      }
    }
  }

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

resource "oci_core_security_list" "private_app" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-private-app-sl"
  vcn_id         = oci_core_vcn.demo.id

  ingress_security_rules {
    protocol = "6"
    source   = local.public_cidr
    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = local.public_cidr
    tcp_options {
      min = 3000
      max = 3000
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = local.private_cidr
    tcp_options {
      min = 3000
      max = 3000
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = local.private_cidr
    tcp_options {
      min = 6379
      max = 6379
    }
  }

  dynamic "ingress_security_rules" {
    for_each = var.create_debug_bastion ? [1] : []

    content {
      protocol = "6"
      source   = local.public_cidr
      tcp_options {
        min = 22
        max = 22
      }
    }
  }

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

resource "oci_core_subnet" "public" {
  cidr_block                 = local.public_cidr
  compartment_id             = var.compartment_ocid
  display_name               = "${local.name_prefix}-public"
  dns_label                  = "public"
  prohibit_public_ip_on_vnic = false
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.public_lb.id]
  vcn_id                     = oci_core_vcn.demo.id
}

resource "oci_core_subnet" "private" {
  cidr_block                 = local.private_cidr
  compartment_id             = var.compartment_ocid
  display_name               = "${local.name_prefix}-private"
  dns_label                  = "private"
  prohibit_public_ip_on_vnic = true
  route_table_id             = oci_core_route_table.private.id
  security_list_ids          = [oci_core_security_list.private_app.id]
  vcn_id                     = oci_core_vcn.demo.id
}

resource "oci_redis_redis_cluster" "live_players" {
  count              = var.create_redis_cache ? 1 : 0
  cluster_mode       = "NONSHARDED"
  compartment_id     = var.compartment_ocid
  display_name       = "${local.name_prefix}-live-players"
  node_count         = var.redis_node_count
  node_memory_in_gbs = var.redis_node_memory_in_gbs
  software_version   = var.redis_software_version
  subnet_id          = oci_core_subnet.private.id
}

resource "oci_load_balancer_load_balancer" "web" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-web-lb"
  shape          = "flexible"
  subnet_ids     = [oci_core_subnet.public.id]

  shape_details {
    minimum_bandwidth_in_mbps = 10
    maximum_bandwidth_in_mbps = 10
  }
}

resource "oci_load_balancer_load_balancer" "api" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-api-lb"
  is_private     = true
  shape          = "flexible"
  subnet_ids     = [oci_core_subnet.private.id]

  shape_details {
    minimum_bandwidth_in_mbps = 10
    maximum_bandwidth_in_mbps = 10
  }
}

resource "oci_core_instance" "debug_bastion" {
  count               = var.create_debug_bastion ? 1 : 0
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_ocid
  display_name        = "${local.name_prefix}-debug-bastion"
  shape               = var.debug_bastion_shape

  shape_config {
    memory_in_gbs = var.debug_bastion_memory_gbs
    ocpus         = var.debug_bastion_ocpus
  }

  create_vnic_details {
    assign_public_ip = true
    display_name     = "${local.name_prefix}-debug-bastion-vnic"
    subnet_id        = oci_core_subnet.public.id
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
  }

  source_details {
    source_id   = var.instance_image_ocid
    source_type = "image"
  }
}

resource "oci_core_instance_configuration" "app" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-app-config"

  lifecycle {
    create_before_destroy = true
  }

  instance_details {
    instance_type = "compute"

    launch_details {
      compartment_id = var.compartment_ocid
      display_name   = "${local.name_prefix}-vm"
      shape          = var.instance_shape

      create_vnic_details {
        assign_public_ip = false
        display_name     = "${local.name_prefix}-app-vnic"
        subnet_id        = oci_core_subnet.private.id
      }

      metadata = {
        ssh_authorized_keys = var.ssh_public_key
        user_data           = local.app_user_data
      }

      shape_config {
        memory_in_gbs = var.instance_memory_gbs
        ocpus         = var.instance_ocpus
      }

      source_details {
        image_id    = var.instance_image_ocid
        source_type = "image"
      }
    }
  }
}

resource "oci_load_balancer_backend_set" "web" {
  load_balancer_id = oci_load_balancer_load_balancer.web.id
  name             = "web-backends"
  policy           = "ROUND_ROBIN"

  health_checker {
    protocol = "HTTP"
    port     = 80
    url_path = "/"
  }
}

resource "oci_load_balancer_listener" "web" {
  default_backend_set_name = oci_load_balancer_backend_set.web.name
  load_balancer_id         = oci_load_balancer_load_balancer.web.id
  name                     = "http"
  port                     = 80
  protocol                 = "HTTP"
}

resource "oci_load_balancer_backend_set" "api" {
  load_balancer_id = oci_load_balancer_load_balancer.api.id
  name             = "api-backends"
  policy           = "ROUND_ROBIN"

  health_checker {
    protocol = "HTTP"
    port     = 3000
    url_path = "/healthz"
  }
}

resource "oci_core_instance_pool" "app" {
  compartment_id              = var.compartment_ocid
  display_name                = "${local.name_prefix}-app-pool"
  instance_configuration_id   = oci_core_instance_configuration.app.id
  instance_hostname_formatter = "ocidefense-${random_id.suffix.hex}-$${launchCount}"
  size                        = var.instance_pool_initial_size

  dynamic "placement_configurations" {
    for_each = data.oci_identity_availability_domains.ads.availability_domains

    content {
      availability_domain = placement_configurations.value.name

      primary_vnic_subnets {
        subnet_id = oci_core_subnet.private.id
      }
    }
  }

  load_balancers {
    backend_set_name = oci_load_balancer_backend_set.web.name
    load_balancer_id = oci_load_balancer_load_balancer.web.id
    port             = 80
    vnic_selection   = "PrimaryVnic"
  }

  load_balancers {
    backend_set_name = oci_load_balancer_backend_set.api.name
    load_balancer_id = oci_load_balancer_load_balancer.api.id
    port             = 3000
    vnic_selection   = "PrimaryVnic"
  }
}

resource "oci_load_balancer_listener" "api" {
  default_backend_set_name = oci_load_balancer_backend_set.api.name
  load_balancer_id         = oci_load_balancer_load_balancer.api.id
  name                     = "api"
  port                     = 3000
  protocol                 = "HTTP"
}

resource "oci_autoscaling_auto_scaling_configuration" "app" {
  compartment_id       = var.compartment_ocid
  cool_down_in_seconds = var.autoscaling_cooldown_seconds
  display_name         = "${local.name_prefix}-autoscaling"
  is_enabled           = var.enable_autoscaling

  auto_scaling_resources {
    id   = oci_core_instance_pool.app.id
    type = "instancePool"
  }

  policies {
    display_name = "${local.name_prefix}-cpu-policy"
    is_enabled   = var.enable_autoscaling
    policy_type  = "threshold"

    capacity {
      initial = var.instance_pool_initial_size
      max     = var.instance_pool_max_size
      min     = var.instance_pool_min_size
    }

    rules {
      display_name = "scale-out-cpu"

      action {
        type  = "CHANGE_COUNT_BY"
        value = 1
      }

      metric {
        metric_type = "CPU_UTILIZATION"

        threshold {
          operator = "GT"
          value    = var.autoscaling_cpu_scale_out_threshold
        }
      }
    }

    rules {
      display_name = "scale-in-cpu"

      action {
        type  = "CHANGE_COUNT_BY"
        value = -1
      }

      metric {
        metric_type = "CPU_UTILIZATION"

        threshold {
          operator = "LT"
          value    = var.autoscaling_cpu_scale_in_threshold
        }
      }
    }
  }
}

resource "oci_apigateway_gateway" "demo" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-gateway"
  endpoint_type  = "PUBLIC"
  subnet_id      = oci_core_subnet.public.id
}

resource "oci_apigateway_deployment" "demo" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-api"
  gateway_id     = oci_apigateway_gateway.demo.id
  path_prefix    = "/"

  specification {
    request_policies {
      cors {
        allowed_headers    = ["Content-Type", "Authorization"]
        allowed_methods    = ["GET", "POST", "OPTIONS"]
        allowed_origins    = ["*"]
        exposed_headers    = ["opc-request-id"]
        max_age_in_seconds = 600
      }
    }

    routes {
      path    = "/api/status"
      methods = ["GET"]
      backend {
        type = "HTTP_BACKEND"
        url  = "http://${local.api_lb_ip}:3000/api/status"
      }
    }

    dynamic "routes" {
      for_each = local.function_ingest_enabled ? [] : [1]

      content {
        path    = "/api/events"
        methods = ["POST", "OPTIONS"]
        backend {
          type = "HTTP_BACKEND"
          url  = "http://${local.api_lb_ip}:3000/api/events"
        }
      }
    }

    dynamic "routes" {
      for_each = local.function_ingest_enabled ? [oci_functions_function.optional_ingest[0].id] : []

      content {
        path    = "/api/events"
        methods = ["POST", "OPTIONS"]
        backend {
          type        = "ORACLE_FUNCTIONS_BACKEND"
          function_id = routes.value
        }
      }
    }

    routes {
      path    = "/api/leaderboard"
      methods = ["GET"]
      backend {
        type = "HTTP_BACKEND"
        url  = "http://${local.api_lb_ip}:3000/api/leaderboard"
      }
    }

    routes {
      path    = "/api/players/live"
      methods = ["GET"]
      backend {
        type = "HTTP_BACKEND"
        url  = "http://${local.api_lb_ip}:3000/api/players/live"
      }
    }

    routes {
      path    = "/api/analytics/live"
      methods = ["GET"]
      backend {
        type = "HTTP_BACKEND"
        url  = "http://${local.api_lb_ip}:3000/api/analytics/live"
      }
    }

    routes {
      path    = "/api/analytics/events"
      methods = ["GET"]
      backend {
        type = "HTTP_BACKEND"
        url  = "http://${local.api_lb_ip}:3000/api/analytics/events"
      }
    }

    routes {
      path    = "/api/stress"
      methods = ["GET", "POST", "OPTIONS"]
      backend {
        type = "HTTP_BACKEND"
        url  = "http://${local.api_lb_ip}:3000/api/stress"
      }
    }

    routes {
      path    = "/api/copilot"
      methods = ["POST", "OPTIONS"]
      backend {
        type = "HTTP_BACKEND"
        url  = "http://${local.api_lb_ip}:3000/api/copilot"
      }
    }

    routes {
      path    = "/api/coach"
      methods = ["POST", "OPTIONS"]
      backend {
        type = "HTTP_BACKEND"
        url  = "http://${local.api_lb_ip}:3000/api/coach"
      }
    }
  }
}

resource "oci_streaming_stream_pool" "demo" {
  compartment_id = var.compartment_ocid
  name           = "${local.name_prefix}-stream-pool"
}

resource "oci_streaming_stream" "events" {
  name               = "${local.name_prefix}-events"
  partitions         = 1
  retention_in_hours = 24
  stream_pool_id     = oci_streaming_stream_pool.demo.id
}

resource "oci_objectstorage_bucket" "raw_events" {
  compartment_id = var.compartment_ocid
  name           = "${local.name_prefix}-raw-events"
  namespace      = data.oci_objectstorage_namespace.namespace.namespace
  access_type    = "NoPublicAccess"
}

resource "oci_database_autonomous_database" "demo" {
  count                       = var.create_autonomous_database ? 1 : 0
  admin_password              = var.adb_admin_password
  compartment_id              = var.compartment_ocid
  compute_count               = var.adb_compute_count
  compute_model               = var.adb_compute_model
  data_storage_size_in_gb     = var.adb_data_storage_size_gb
  db_name                     = replace(substr(local.name_prefix, 0, 14), "-", "")
  db_workload                 = "AJD"
  display_name                = "${local.name_prefix}-adb"
  is_free_tier                = var.adb_is_free_tier
  is_mtls_connection_required = var.adb_is_mtls_connection_required
  license_model               = "LICENSE_INCLUDED"
  whitelisted_ips             = local.adb_whitelisted_ips
}

resource "oci_functions_application" "demo" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-fn-app"
  subnet_ids     = [oci_core_subnet.private.id]
}

resource "oci_functions_function" "optional_ingest" {
  count              = var.function_image == "" ? 0 : 1
  application_id     = oci_functions_application.demo.id
  display_name       = "${local.name_prefix}-event-ingest"
  image              = var.function_image
  memory_in_mbs      = 256
  timeout_in_seconds = 30

  config = {
    ADB_CONNECT_STRING          = local.adb_app_connect_string
    ADB_PASSWORD                = var.adb_admin_password
    ADB_USER                    = var.adb_user
    LIVE_PLAYER_TTL_SECONDS     = tostring(var.live_player_ttl_seconds)
    OCI_BUCKET_NAME             = oci_objectstorage_bucket.raw_events.name
    OCI_NAMESPACE               = data.oci_objectstorage_namespace.namespace.namespace
    OCI_REGION                  = var.region
    OCI_STREAM_MESSAGE_ENDPOINT = oci_streaming_stream.events.messages_endpoint
    OCI_STREAM_OCID             = oci_streaming_stream.events.id
    REDIS_HOST                  = local.redis_host
    REDIS_PORT                  = local.redis_port
    REDIS_TLS                   = local.redis_tls
  }
}
