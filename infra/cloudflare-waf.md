# Cloudflare WAF Configuration for Stellar MarketPay

## Overview

This document outlines the Cloudflare WAF (Web Application Firewall) rules and configuration to protect the Stellar MarketPay API endpoints from L7 DDoS attacks and other security threats.

## Security Objectives

- **Rate Limiting**: Prevent abuse of critical API endpoints
- **Bot Mitigation**: Block automated bots and scrapers
- **Geo-Blocking**: Challenge requests from high-risk geographic regions
- **DDoS Protection**: Mitigate Layer 7 attacks at the edge

## WAF Rule Configuration

### 1. Rate Limiting Rules

#### API Authentication Endpoint
- **Rule Name**: `Rate Limit - API Auth`
- **Field**: `URI Path`
- **Operator**: `equals`
- **Value**: `/api/auth/*`
- **Rate Limit**: 10 requests per minute per IP
- **Action**: Challenge (JavaScript challenge)
- **Duration**: 1 minute
- **Rationale**: Authentication endpoints are common targets for credential stuffing attacks

#### API Escrow Endpoint
- **Rule Name**: `Rate Limit - API Escrow`
- **Field**: `URI Path`
- **Operator**: `equals`
- **Value**: `/api/escrow/*`
- **Rate Limit**: 5 requests per minute per IP
- **Action**: Block
- **Duration**: 5 minutes
- **Rationale**: Escrow operations involve financial transactions and require strict rate limiting

#### General API Rate Limit
- **Rule Name**: `Rate Limit - General API`
- **Field**: `URI Path`
- **Operator**: `starts with`
- **Value**: `/api/`
- **Rate Limit**: 100 requests per minute per IP
- **Action**: Challenge
- **Duration**: 1 minute
- **Rationale**: Baseline protection for all API endpoints

### 2. Bot Fight Mode

- **Setting**: Enable Bot Fight Mode
- **Action**: Challenge suspicious bot traffic
- **Rationale**: Automatically detects and challenges bots without legitimate user agents

### 3. Geographic Challenge Rules

#### High-Risk Countries
- **Rule Name**: `Geo Challenge - High Risk Countries`
- **Field**: `Country`
- **Operator**: `in`
- **Value**: `CN, RU, KP, IR` (China, Russia, North Korea, Iran)
- **Action**: Challenge (Captcha challenge)
- **Rationale**: These regions have historically high rates of automated attacks and no legitimate user base for Stellar MarketPay

#### Allowlist for Legitimate Regions
- **Rule Name**: `Geo Allow - Legitimate Regions`
- **Field**: `Country`
- **Operator**: `in`
- **Value**: `US, GB, DE, FR, CA, AU, JP, SG, IN, BR, ES, PT, NL, IT, SE, NO, DK, FI, CH, AT, BE, IE, PL, CZ, HU, GR, TR, IL, AE, ZA, KE, NG, MX, AR, CO, CL, PE`
- **Action**: Skip
- **Rationale**: Allow known legitimate user regions to bypass geographic challenges

### 4. Managed Ruleset Configuration

#### Cloudflare Managed Ruleset
- **Ruleset**: `Cloudflare Managed Ruleset`
- **Action**: Block
- **Sensitivity**: Medium
- **Paranoia Level**: 1
- **Rationale**: Baseline protection against common vulnerabilities (SQLi, XSS, etc.)

#### OWASP ModSecurity Core Rule Set
- **Ruleset**: `OWASP ModSecurity Core Rule Set`
- **Action**: Block
- **Sensitivity**: Low
- **Paranoia Level**: 1
- **Rationale**: Additional protection layer for web application vulnerabilities

### 5. Custom WAF Rules

#### SQL Injection Protection
- **Rule Name**: `Block SQL Injection`
- **Expression**: `(http.request.uri contains "SELECT" or http.request.uri contains "UNION" or http.request.uri contains "DROP" or http.request.body contains "OR 1=1")`
- **Action**: Block
- **Rationale**: Prevent SQL injection attacks

#### XSS Protection
- **Rule Name**: `Block XSS Attacks`
- **Expression**: `(http.request.uri contains "<script" or http.request.uri contains "javascript:" or http.request.body contains "onerror=")`
- **Action**: Block
- **Rationale**: Prevent cross-site scripting attacks

#### Stellar-Specific Protection
- **Rule Name**: `Block Stellar Key Harvesting`
- **Expression**: `(http.request.uri contains "S[A-Z0-9]{55}" or http.request.body contains "S[A-Z0-9]{55}")`
- **Action**: Block
- **Rationale**: Prevent attempts to harvest Stellar public/private keys

## Terraform Configuration

The Terraform configuration for these WAF rules is located in `infra/cloudflare/`. See the Terraform files for the exact implementation.

## Monitoring and Alerts

### Cloudflare Analytics
- Monitor the following metrics:
  - Rate limit triggers per endpoint
  - Bot Fight Mode challenges
  - Geographic challenge pass/fail rates
  - WAF rule match counts

### Alert Thresholds
- **Critical**: >1000 rate limit triggers per hour
- **Warning**: >100 geographic challenge failures per hour
- **Info**: Weekly summary of blocked requests

## Testing

### Testing Rate Limits
```bash
# Test auth endpoint rate limit (should fail after 10 requests)
for i in {1..15}; do
  curl -X POST https://api.stellar-marketpay.com/api/auth/challenge \
    -H "Content-Type: application/json" \
    -d '{"publicKey":"G..."}'
  echo "Request $i"
done
```

### Testing Geographic Challenges
- Use VPN services from blocked regions to verify challenge behavior
- Verify that legitimate regions can access without challenges

### Testing Bot Fight Mode
- Use curl with common bot user agents to verify challenge behavior
- Verify that legitimate browsers pass through

## Maintenance

### Regular Reviews
- Review WAF logs weekly for false positives
- Update geographic allowlist based on user growth
- Adjust rate limits based on traffic patterns
- Update managed rulesets when Cloudflare releases updates

### Incident Response
- If legitimate traffic is blocked:
  1. Check WAF logs for matching rules
  2. Add specific IPs to allowlist if needed
  3. Adjust rule sensitivity if pattern is too aggressive
  4. Document false positive for future reference

## References

- [Cloudflare WAF Documentation](https://developers.cloudflare.com/waf/)
- [Cloudflare Rate Limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Cloudflare Bot Fight Mode](https://developers.cloudflare.com/bots/bot-fight-mode/)
- [OWASP ModSecurity CRS](https://coreruleset.org/)
