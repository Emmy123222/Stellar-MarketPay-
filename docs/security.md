# Security Policy

## Container Image Scanning

We take security seriously and have integrated automated security scanning into our CI/CD pipeline using [Trivy](https://trivy.dev/).

### Process
1. **Automated Scanning**: During the CI build process, all Docker images (e.g., backend, frontend) are automatically scanned for vulnerabilities.
2. **Failure Threshold**: The CI pipeline is configured to automatically fail if any vulnerabilities with a severity of **CRITICAL** or **HIGH** are detected in the images.
3. **Artifacts**: The detailed scan reports in SARIF format are uploaded as artifacts for each CI run, which can be downloaded and reviewed. They are also uploaded to the GitHub Security tab for easy tracking.

### Handling False Positives
Occasionally, security scanners may flag vulnerabilities that are false positives or are not applicable to our specific runtime environment (e.g., a vulnerability in a development dependency that is never loaded in production).

If a vulnerability is determined to be a false positive or an acceptable risk:
1. Document the reasoning for ignoring the vulnerability.
2. Add the CVE identifier to the `.trivyignore` file located at the root of the repository.
3. Include a comment in `.trivyignore` directly above the CVE explaining why it is being ignored, ensuring future maintainers understand the context.
