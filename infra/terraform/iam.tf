locals {
  demo_dynamic_group_ref         = var.demo_identity_domain_name == "" ? var.demo_dynamic_group_name : "${var.demo_identity_domain_name}/${var.demo_dynamic_group_name}"
  demo_genai_compartment_ocid    = coalesce(var.oci_genai_compartment_ocid, var.compartment_ocid)
  demo_iam_policy_compartment_id = coalesce(var.demo_iam_policy_compartment_ocid, var.tenancy_ocid)
}

resource "oci_identity_dynamic_group" "demo_runtime" {
  count          = var.manage_demo_iam ? 1 : 0
  provider       = oci.home
  compartment_id = var.tenancy_ocid
  description    = "OCI Defense Grid demo runtime principals for app VMs and OCI Functions."
  name           = var.demo_dynamic_group_name
  matching_rule  = "Any {All {instance.compartment.id = '${var.compartment_ocid}'}, All {resource.type = 'fnfunc', resource.compartment.id = '${var.compartment_ocid}'}}"
}

resource "oci_identity_policy" "demo_runtime" {
  count          = var.manage_demo_iam ? 1 : 0
  provider       = oci.home
  compartment_id = local.demo_iam_policy_compartment_id
  description    = "OCI Defense Grid runtime access for Streaming, Object Storage and OCI Generative AI."
  name           = var.demo_runtime_policy_name

  statements = [
    "Allow dynamic-group ${local.demo_dynamic_group_ref} to use stream-push in compartment id ${var.compartment_ocid}",
    "Allow dynamic-group ${local.demo_dynamic_group_ref} to use stream-pull in compartment id ${var.compartment_ocid}",
    "Allow dynamic-group ${local.demo_dynamic_group_ref} to manage objects in compartment id ${var.compartment_ocid} where target.bucket.name='${oci_objectstorage_bucket.raw_events.name}'",
    "Allow dynamic-group ${local.demo_dynamic_group_ref} to use generative-ai-family in compartment id ${local.demo_genai_compartment_ocid}"
  ]

  depends_on = [oci_identity_dynamic_group.demo_runtime]
}

resource "oci_identity_policy" "api_gateway_functions" {
  count          = var.manage_demo_iam ? 1 : 0
  provider       = oci.home
  compartment_id = local.demo_iam_policy_compartment_id
  description    = "OCI Defense Grid API Gateway permission to invoke OCI Functions."
  name           = var.api_gateway_invoke_policy_name

  statements = [
    "Allow any-user to use functions-family in compartment id ${var.compartment_ocid} where ALL {request.principal.type = 'ApiGateway', request.resource.compartment.id = '${var.compartment_ocid}'}"
  ]
}
