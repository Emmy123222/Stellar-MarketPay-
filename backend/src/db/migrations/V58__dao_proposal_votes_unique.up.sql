ALTER TABLE dao_votes ADD CONSTRAINT dao_votes_proposal_id_voter_address_key UNIQUE (proposal_id, voter_address);
