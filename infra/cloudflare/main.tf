terraform {
  required_version = ">= 1.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

variable "cloudflare_api_token" {
  type        = string
  description = "Cloudflare API token with Zone:Zone and Zone:Firewall Services permissions"
  sensitive   = true
}

variable "zone_id" {
  type        = string
  description = "Cloudflare Zone ID for stellar-marketpay.com"
}

variable "zone_name" {
  type        = string
  description = "Zone name (e.g., stellar-marketpay.com)"
  default     = "stellar-marketpay.com"
}

# Rate Limit - API Auth (10 req/min per IP)
resource "cloudflare_rate_limit" "api_auth" {
  zone_id     = var.zone_id
  description = "Rate limit for API authentication endpoints - 10 req/min per IP"
  match {
    request {
      url_pattern = "/api/auth/*"
      schemes     = ["HTTP", "HTTPS"]
      methods     = ["POST", "GET", "PUT", "DELETE"]
    }
    response {
      statuses        = [200, 201, 202, 204, 400, 401, 403, 404, 500, 502, 503]
      origin_traffic  = true
    }
  }
  action {
    mode    = "challenge"
    timeout = 60
  }
  period  = 60
  limit   = 10
}

# Rate Limit - API Escrow (5 req/min per IP)
resource "cloudflare_rate_limit" "api_escrow" {
  zone_id     = var.zone_id
  description = "Rate limit for API escrow endpoints - 5 req/min per IP"
  match {
    request {
      url_pattern = "/api/escrow/*"
      schemes     = ["HTTP", "HTTPS"]
      methods     = ["POST", "GET", "PUT", "DELETE"]
    }
    response {
      statuses        = [200, 201, 202, 204, 400, 401, 403, 404, 500, 502, 503]
      origin_traffic  = true
    }
  }
  action {
    mode    = "block"
    timeout = 300
  }
  period  = 60
  limit   = 5
}

# Rate Limit - General API (100 req/min per IP)
resource "cloudflare_rate_limit" "api_general" {
  zone_id     = var.zone_id
  description = "General rate limit for all API endpoints - 100 req/min per IP"
  match {
    request {
      url_pattern = "/api/*"
      schemes     = ["HTTP", "HTTPS"]
      methods     = ["POST", "GET", "PUT", "DELETE", "PATCH"]
    }
    response {
      statuses        = [200, 201, 202, 204, 400, 401, 403, 404, 500, 502, 503]
      origin_traffic  = true
    }
  }
  action {
    mode    = "challenge"
    timeout = 60
  }
  period  = 60
  limit   = 100
}

# Enable Bot Fight Mode
resource "cloudflare_bot_management_mode" "bot_fight" {
  zone_id = var.zone_id
  mode    = "fight_mode"
}

# Geographic Challenge Rule - High Risk Countries
resource "cloudflare_firewall_rule" "geo_challenge_high_risk" {
  zone_id     = var.zone_id
  description = "Challenge requests from high-risk geographic regions"
  name        = "Geo Challenge - High Risk Countries"
  expression  = "ip.geoip.country in {\"CN\" \"RU\" \"KP\" \"IR\"}"
  action      = "challenge"
}

# Geographic Allow Rule - Legitimate Regions
resource "cloudflare_firewall_rule" "geo_allow_legitimate" {
  zone_id     = var.zone_id
  description = "Allow requests from legitimate user regions"
  name        = "Geo Allow - Legitimate Regions"
  expression  = "ip.geoip.country in {\"US\" \"GB\" \"DE\" \"FR\" \"CA\" \"AU\" \"JP\" \"SG\" \"IN\" \"BR\" \"ES\" \"PT\" \"NL\" \"IT\" \"SE\" \"NO\" \"DK\" \"FI\" \"CH\" \"AT\" \"BE\" \"IE\" \"PL\" \"CZ\" \"HU\" \"GR\" \"TR\" \"IL\" \"AE\" \"ZA\" \"KE\" \"NG\" \"MX\" \"AR\" \"CO\" \"CL\" \"PE\"}"
  action      = "skip"
  filter {
    query_parameter = ""
    operator        = ""
    value           = ""
  }
}

# Custom WAF Rule - Block SQL Injection
resource "cloudflare_firewall_rule" "block_sql_injection" {
  zone_id     = var.zone_id
  description = "Block SQL injection attempts"
  name        = "Block SQL Injection"
  expression  = "(http.request.uri contains \"SELECT\" or http.request.uri contains \"UNION\" or http.request.uri contains \"DROP\" or http.request.body contains \"OR 1=1\")"
  action      = "block"
}

# Custom WAF Rule - Block XSS Attacks
resource "cloudflare_firewall_rule" "block_xss" {
  zone_id     = var.zone_id
  description = "Block cross-site scripting attacks"
  name        = "Block XSS Attacks"
  expression  = "(http.request.uri contains \"<script\" or http.request.uri contains \"javascript:\" or http.request.body contains \"onerror=\")"
  action      = "block"
}

# Custom WAF Rule - Block Stellar Key Harvesting
resource "cloudflare_firewall_rule" "block_stellar_key_harvesting" {
  zone_id     = var.zone_id
  description = "Block attempts to harvest Stellar public/private keys"
  name        = "Block Stellar Key Harvesting"
  expression  = "(http.request.uri contains \"S[A-Z0-9]{55}\" or http.request.body contains \"S[A-Z0-9]{55}\")"
  action      = "block"
}

# Enable Cloudflare Managed Ruleset
resource "cloudflare_ruleset" "cloudflare_managed" {
  zone_id     = var.zone_id
  name        = "Cloudflare Managed Ruleset"
  description = "Enable Cloudflare Managed Ruleset for baseline protection"
  kind        = "managed"
  phase       = "http_request_firewall_custom"

  rules {
    action = "block"
    expression = "(cf.edge.bot_score.score gt 30)"
    enabled = true
  }
}

# Output important values
output "rate_limits" {
  description = "Rate limit IDs"
  value = {
    api_auth    = cloudflare_rate_limit.api_auth.id
    api_escrow  = cloudflare_rate_limit.api_escrow.id
    api_general = cloudflare_rate_limit.api_general.id
  }
}

output "firewall_rules" {
  description = "Firewall rule IDs"
  value = {
    geo_challenge_high_risk    = cloudflare_firewall_rule.geo_challenge_high_risk.id
    geo_allow_legitimate      = cloudflare_firewall_rule.geo_allow_legitimate.id
    block_sql_injection       = cloudflare_firewall_rule.block_sql_injection.id
    block_xss                 = cloudflare_firewall_rule.block_xss.id
    block_stellar_key_harvesting = cloudflare_firewall_rule.block_stellar_key_harvesting.id
  }
}
