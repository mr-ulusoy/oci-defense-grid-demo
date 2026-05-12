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
  description = "Oracle Linux image OCID for the selected region."
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

variable "enable_autoscaling" {
  description = "Enable OCI autoscaling for the app instance pool."
  type        = bool
  default     = true
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

variable "adb_is_free_tier" {
  description = "Create Autonomous Database as Always Free where supported."
  type        = bool
  default     = true
}

variable "create_analytics_instance" {
  description = "Create an Oracle Analytics Cloud instance for the dashboard story."
  type        = bool
  default     = false
}

variable "analytics_idcs_access_token" {
  description = "IDCS access token required when create_analytics_instance is true."
  type        = string
  default     = null
  sensitive   = true
}

variable "function_image" {
  description = "Optional OCIR image for the event ingest/copilot function. Leave empty for V1 VM-backed API routes."
  type        = string
  default     = ""
}

variable "create_instance_principal_policy" {
  description = "Create a tenancy-level dynamic group and policy so VMs can write to Streaming and Object Storage."
  type        = bool
  default     = false
}
