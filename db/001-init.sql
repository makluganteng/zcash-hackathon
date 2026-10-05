CREATE TABLE IF NOT EXISTS auctions (
  id text PRIMARY KEY, title text NOT NULL, description text NOT NULL, category text NOT NULL DEFAULT 'Collectible',
  item_hash text NOT NULL, creation_tx text, public_state jsonb, proof_bundle jsonb,
  worker_status text NOT NULL DEFAULT 'pending', worker_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS creation_requests (
  id uuid PRIMARY KEY, request_hash text NOT NULL, title text NOT NULL, description text NOT NULL, category text NOT NULL,
  item_hash text NOT NULL, transaction_hash text NOT NULL, raw_transaction text NOT NULL, auction_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE creation_requests ADD COLUMN IF NOT EXISTS failed boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS bid_blobs (
  ciphertext_hash text PRIMARY KEY, ciphertext text NOT NULL CHECK (octet_length(ciphertext) <= 131072), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bid_submissions (
  auction_id text NOT NULL REFERENCES auctions(id), bidder text NOT NULL, commitment text NOT NULL, ciphertext_hash text NOT NULL REFERENCES bid_blobs(ciphertext_hash),
  signature text NOT NULL, transaction_hash text, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(auction_id,bidder), UNIQUE(auction_id,commitment)
);
ALTER TABLE bid_submissions ADD COLUMN IF NOT EXISTS raw_transaction text;
CREATE TABLE IF NOT EXISTS claim_challenges (
  id uuid PRIMARY KEY, auction_id text NOT NULL REFERENCES auctions(id), bidder text NOT NULL, message text NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY, auction_id text NOT NULL UNIQUE REFERENCES auctions(id), payload jsonb NOT NULL,
  signature text NOT NULL, signer text NOT NULL, status text NOT NULL DEFAULT 'awaiting-payment', confirmations integer NOT NULL DEFAULT 0,
  suspended boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS claim_sessions (
  token_hash text PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_observations (
  txid text NOT NULL, output_id text NOT NULL, invoice_id uuid NOT NULL REFERENCES invoices(id), amount text NOT NULL,
  confirmations integer NOT NULL, active boolean NOT NULL, first_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(txid,output_id)
);
CREATE TABLE IF NOT EXISTS worker_health (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), checked_at timestamptz NOT NULL, status text NOT NULL
);
ALTER TABLE worker_health ADD COLUMN IF NOT EXISTS payment_ready boolean NOT NULL DEFAULT false;
ALTER TABLE worker_health ADD COLUMN IF NOT EXISTS payment_destination_hash text;
