# 001. Use SEP-10 for Authentication

## Status
Accepted

## Context
The project requires a secure and seamless way for users to authenticate using their Stellar wallets. We evaluated several authentication mechanisms, including:

- **Password Auth**: Requires managing passwords securely (hashing, salting) and implementing password recovery flows. It adds friction to the user experience for a Web3 application and introduces security risks associated with password storage.
- **OAuth**: Relies on centralized identity providers (e.g., Google, GitHub), which contradicts the decentralized nature of the application and adds dependencies on external platforms.
- **Pure JWT**: While JSON Web Tokens are excellent for maintaining session state, issuing them securely without an initial strong authentication challenge is problematic.
- **SEP-10 (Stellar Web Authentication)**: A standardized protocol for Stellar-based applications that uses the user's Stellar account (public key) and a cryptographic signature to prove ownership of the account.

## Decision
We have decided to use **SEP-10 (Stellar Web Authentication)** as the primary authentication mechanism for the application.

SEP-10 provides a standard way to verify that a user possesses the private key associated with a Stellar account. The flow involves the server providing a challenge transaction, the client signing it with their Stellar wallet, and the server verifying the signature before issuing a session token (such as a JWT for subsequent API requests).

Reference: [SEP-0010: Stellar Web Authentication](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md)

## Consequences

- **Positive**:
  - Aligns with Web3 paradigms by using cryptographic signatures for authentication.
  - Eliminates the need to store passwords or manage account recovery via email/SMS.
  - Seamless integration with standard Stellar wallets (e.g., Freighter, xBull, Albedo).
  - Enhances security as authentication is inherently tied to the possession of the private key.

- **Negative**:
  - Users must have a Stellar wallet installed or configured to use the application.
  - Adds complexity to the client-side implementation to handle the challenge-response flow with wallet extensions.
  - Requires handling the transition from the SEP-10 challenge to session management (e.g., issuing and validating a JWT post-authentication).
