terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.0.0, < 6.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6.0"
    }
  }
}

provider "oci" {
  auth                = var.oci_auth
  config_file_profile = var.oci_config_file_profile
  region              = var.region
}

provider "oci" {
  alias               = "home"
  auth                = var.oci_auth
  config_file_profile = var.oci_config_file_profile
  region              = var.home_region
}
