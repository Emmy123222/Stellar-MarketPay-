# Dispute Resolution API

Dispute resolution and IPFS evidence routes are served under `/api/disputes`.
The interactive API reference is available at `/api/docs`.

- `GET /api/disputes/{jobId}`: retrieve dispute details and evidence availability.
- `GET /api/disputes/{jobId}/events`: retrieve the dispute timeline.
- `GET /api/disputes/{jobId}/onchain-cids`: retrieve chain-attested evidence CIDs.
- `POST /api/disputes/{jobId}/evidence`: upload evidence (JWT required).
- `GET /api/disputes/{jobId}/evidence`: list evidence (JWT required; client, freelancer, or arbitrator).
- `GET /api/disputes/{jobId}/evidence/{id}/url`: generate a signed evidence URL (JWT required).
- `GET /api/disputes/{jobId}/evidence/{id}/proxy?token={token}`: retrieve evidence using a signed URL token.
