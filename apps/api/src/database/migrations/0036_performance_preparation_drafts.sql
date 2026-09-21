CREATE TABLE performance_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  performance_id uuid REFERENCES performances(id) ON DELETE RESTRICT,
  data jsonb NOT NULL,
  step varchar(20) NOT NULL DEFAULT 'basic' CHECK (step IN ('basic', 'seats', 'content', 'review')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  base_updated_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX idx_performance_drafts_owner_updated ON performance_drafts(owner_user_id, updated_at);
