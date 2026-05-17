#!/usr/bin/env node
import { createRequire } from 'node:module';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { default: pg } = await import(apiRequire.resolve('pg'));

const DEFAULT_OLD_PREFIX = 'https://pub-9eb4eb2187b94ca8a746f62301c0a87f.r2.dev';
const DEFAULT_NEW_PREFIX = 'https://cdn.heygrabit.com';

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).replace(/\/+$/, '') : fallback;
}

const oldPrefix = readArg('old-prefix', DEFAULT_OLD_PREFIX);
const newPrefix = readArg('new-prefix', DEFAULT_NEW_PREFIX);
const apply = process.argv.includes('--apply');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

if (oldPrefix === newPrefix) {
  throw new Error('old-prefix and new-prefix must differ');
}

const client = new pg.Client({ connectionString: databaseUrl });

async function countMatches() {
  const { rows } = await client.query(
    `
      SELECT 'performances.poster_url' AS target, count(*)::int AS count
      FROM performances
      WHERE poster_url LIKE $1 || '%'
      UNION ALL
      SELECT 'performances.detail_images[].imageUrl' AS target, count(*)::int AS count
      FROM performances p
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p.detail_images) AS image
        WHERE image->>'imageUrl' LIKE $1 || '%'
      )
      UNION ALL
      SELECT 'seat_maps.svg_url' AS target, count(*)::int AS count
      FROM seat_maps
      WHERE svg_url LIKE $1 || '%'
      UNION ALL
      SELECT 'banners.image_url' AS target, count(*)::int AS count
      FROM banners
      WHERE image_url LIKE $1 || '%'
      UNION ALL
      SELECT 'castings.photo_url' AS target, count(*)::int AS count
      FROM castings
      WHERE photo_url LIKE $1 || '%'
    `,
    [oldPrefix],
  );
  return rows;
}

async function applyBackfill() {
  await client.query('BEGIN');
  try {
    await client.query(
      `
        UPDATE performances
        SET poster_url = replace(poster_url, $1, $2)
        WHERE poster_url LIKE $1 || '%'
      `,
      [oldPrefix, newPrefix],
    );

    await client.query(
      `
        WITH rewritten AS (
          SELECT
            p.id,
            jsonb_agg(
              CASE
                WHEN image.value->>'imageUrl' LIKE $1 || '%'
                  THEN jsonb_set(
                    image.value,
                    '{imageUrl}',
                    to_jsonb(replace(image.value->>'imageUrl', $1, $2))
                  )
                ELSE image.value
              END
              ORDER BY image.ordinality
            ) AS detail_images
          FROM performances p
          CROSS JOIN LATERAL jsonb_array_elements(p.detail_images) WITH ORDINALITY AS image(value, ordinality)
          GROUP BY p.id
        )
        UPDATE performances p
        SET detail_images = rewritten.detail_images
        FROM rewritten
        WHERE p.id = rewritten.id
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p.detail_images) AS image
            WHERE image->>'imageUrl' LIKE $1 || '%'
          )
      `,
      [oldPrefix, newPrefix],
    );

    await client.query(
      `
        UPDATE seat_maps
        SET svg_url = replace(svg_url, $1, $2)
        WHERE svg_url LIKE $1 || '%'
      `,
      [oldPrefix, newPrefix],
    );

    await client.query(
      `
        UPDATE banners
        SET image_url = replace(image_url, $1, $2)
        WHERE image_url LIKE $1 || '%'
      `,
      [oldPrefix, newPrefix],
    );

    await client.query(
      `
        UPDATE castings
        SET photo_url = replace(photo_url, $1, $2)
        WHERE photo_url LIKE $1 || '%'
      `,
      [oldPrefix, newPrefix],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

await client.connect();
try {
  console.log('R2 public URL backfill');
  console.log(`oldPrefix=${oldPrefix}`);
  console.log(`newPrefix=${newPrefix}`);
  console.table(await countMatches());

  if (!apply) {
    console.log('dry_run=true; pass --apply to update production data');
    process.exit(0);
  }

  await applyBackfill();
  console.log('after apply');
  console.table(await countMatches());
} finally {
  await client.end();
}
