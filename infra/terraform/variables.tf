variable "tenancy_ocid" {
  description = "OCI tenancy OCID, used for availability-domain lookup and optional IAM policy examples."
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment OCID where demo resources are created."
  type        = string
}

variable "region" {
  description = "OCI region identifier, for example eu-stockholm-1."
  type        = string
}

variable "home_region" {
  description = "OCI tenancy home region identifier, required for IAM dynamic groups and policies."
  type        = string
  default     = "eu-frankfurt-1"
}

variable "oci_auth" {
  description = "OCI Terraform provider authentication mode. Use SecurityToken with oci session authenticate, or APIKey with a long-lived ~/.oci/config API key profile."
  type        = string
  default     = "SecurityToken"
}

variable "oci_config_file_profile" {
  description = "Profile name in ~/.oci/config used by the OCI Terraform provider."
  type        = string
  default     = "DEFAULT"
}

variable "project_name" {
  description = "Human-readable project name used in resource display names."
  type        = string
  default     = "oci-defense-grid"
}

variable "ssh_public_key" {
  description = "SSH public key placed on Compute instances."
  type        = string
}

variable "instance_image_ocid" {
  description = "Compute image OCID for the selected region. The demo cloud-init has been tested with Ubuntu."
  type        = string
}

variable "instance_shape" {
  description = "Compute shape for app VMs."
  type        = string
  default     = "VM.Standard.E4.Flex"
}

variable "instance_ocpus" {
  description = "OCPUs for flexible Compute shapes."
  type        = number
  default     = 1
}

variable "instance_memory_gbs" {
  description = "Memory for flexible Compute shapes."
  type        = number
  default     = 8
}

variable "instance_pool_min_size" {
  description = "Minimum number of app instances kept in the autoscaled pool."
  type        = number
  default     = 2
}

variable "instance_pool_initial_size" {
  description = "Initial app instance count for the instance pool and autoscaling policy."
  type        = number
  default     = 2
}

variable "instance_pool_max_size" {
  description = "Maximum number of app instances autoscaling can scale out to."
  type        = number
  default     = 4
}

variable "create_debug_bastion" {
  description = "Create a temporary public SSH bastion for debugging private app instances."
  type        = bool
  default     = false
}

variable "debug_ssh_source_cidr" {
  description = "CIDR allowed to SSH into the temporary debug bastion."
  type        = string
  default     = "0.0.0.0/32"
}

variable "debug_bastion_shape" {
  description = "Compute shape for the temporary debug bastion."
  type        = string
  default     = "VM.Standard.E4.Flex"
}

variable "debug_bastion_ocpus" {
  description = "OCPUs for the temporary debug bastion."
  type        = number
  default     = 1
}

variable "debug_bastion_memory_gbs" {
  description = "Memory in GB for the temporary debug bastion."
  type        = number
  default     = 4
}

variable "enable_autoscaling" {
  description = "Enable OCI autoscaling for the app instance pool."
  type        = bool
  default     = true
}

variable "create_redis_cache" {
  description = "Create an OCI Cache cluster for live player state shared across app VMs."
  type        = bool
  default     = false
}

variable "redis_host" {
  description = "Existing OCI Cache primary FQDN or Redis-compatible endpoint. Used when create_redis_cache is false."
  type        = string
  default     = ""
}

variable "redis_port" {
  description = "Redis/OCI Cache TLS port."
  type        = number
  default     = 6379
}

variable "redis_tls" {
  description = "Use TLS when connecting to Redis/OCI Cache."
  type        = bool
  default     = true
}

variable "redis_node_count" {
  description = "OCI Cache node count for the non-sharded live player cluster."
  type        = number
  default     = 2
}

variable "redis_node_memory_in_gbs" {
  description = "Memory in GB per OCI Cache node."
  type        = number
  default     = 2
}

variable "redis_software_version" {
  description = "OCI Cache engine version."
  type        = string
  default     = "VALKEY_7_2"
}

variable "live_player_ttl_seconds" {
  description = "How long live player snapshots stay active without new heartbeat/events."
  type        = number
  default     = 60
}

variable "autoscaling_cpu_scale_out_threshold" {
  description = "CPU utilization percent that triggers scale-out."
  type        = number
  default     = 65
}

variable "autoscaling_cpu_scale_in_threshold" {
  description = "CPU utilization percent that triggers scale-in."
  type        = number
  default     = 25
}

variable "autoscaling_cooldown_seconds" {
  description = "Cooldown between autoscaling actions. OCI requires at least 300 seconds."
  type        = number
  default     = 300
}

variable "app_repo_url" {
  description = "Git URL the VMs clone during cloud-init. Point this at your fork of this repo."
  type        = string
}

variable "app_git_ref" {
  description = "Git branch or tag to clone on the app VMs."
  type        = string
  default     = "main"
}

variable "oci_genai_endpoint" {
  description = "Optional OCI Generative AI endpoint used by the demo copilot. Use the base inference endpoint for native SDK calls, or an OpenAI-compatible path for bearer-token calls."
  type        = string
  default     = "https://inference.generativeai.eu-frankfurt-1.oci.oraclecloud.com"
}

variable "oci_genai_bearer_token" {
  description = "Optional bearer token for an OpenAI-compatible demo copilot endpoint. Native OCI SDK mode does not use this value."
  type        = string
  default     = ""
  sensitive   = true
}

variable "oci_genai_model" {
  description = "OCI Generative AI model ID used by the demo copilot."
  type        = string
  default     = "openai.gpt-oss-120b"
}

variable "oci_genai_coach_model" {
  description = "OCI Generative AI model used by the player-facing OCI Guide quiz coach."
  type        = string
  default     = "google.gemini-2.5-flash-lite"
}

variable "ops_access_token" {
  description = "Optional bearer token required for presenter-only ops actions such as copilot, leaderboard AI insights and stress controls. Leave empty only for local demos."
  type        = string
  default     = ""
  sensitive   = true
}

variable "oci_genai_compartment_ocid" {
  description = "Compartment OCID used for OCI Generative AI inference. Defaults to the demo compartment when null."
  type        = string
  default     = null
}

variable "public_api_base_url" {
  description = "Override browser API base URL. Leave empty to use the Terraform-created API Gateway endpoint."
  type        = string
  default     = ""
}

variable "adb_admin_password" {
  description = "Autonomous Database admin password. Must meet OCI password policy."
  type        = string
  sensitive   = true
}

variable "adb_user" {
  description = "Database user used by the app API for Autonomous Database writes."
  type        = string
  default     = "ADMIN"
}

variable "adb_connect_string" {
  description = "Optional app connect descriptor for Autonomous Database. Leave empty to use the Terraform-created ADB LOW service."
  type        = string
  default     = ""
}

variable "adb_is_mtls_connection_required" {
  description = "Require mutual TLS wallet authentication for Autonomous Database. The VM demo app uses TLS without wallet, so this defaults to false."
  type        = bool
  default     = false
}

variable "adb_whitelisted_ips" {
  description = "CIDR allow-list for Autonomous Database public endpoint when mTLS is disabled. Leave empty to allow the demo NAT gateway public IP."
  type        = list(string)
  default     = []
}

variable "adb_compute_model" {
  description = "Autonomous Database compute model."
  type        = string
  default     = "ECPU"
}

variable "adb_compute_count" {
  description = "Autonomous Database compute count. For ECPU serverless, 2 is the smallest standalone paid database size."
  type        = number
  default     = 2
}

variable "adb_data_storage_size_gb" {
  description = "Autonomous Database storage in GB. For paid ECPU Autonomous JSON Database, 20 GB is the smallest storage size."
  type        = number
  default     = 20
}

variable "adb_is_free_tier" {
  description = "Create Autonomous Database as Always Free where supported."
  type        = bool
  default     = true
}

variable "create_autonomous_database" {
  description = "Create an Autonomous JSON Database for analytics. Disable when the tenancy has no ADB free-tier quota."
  type        = bool
  default     = true
}

variable "function_image" {
  description = "Optional OCIR image for the OCI Functions cloud API function. Leave empty to keep /api/events and read APIs on the VM-backed API."
  type        = string
  default     = ""
}
