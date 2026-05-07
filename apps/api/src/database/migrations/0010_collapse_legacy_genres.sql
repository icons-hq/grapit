UPDATE performances
SET genre = CASE
  WHEN genre::text = 'exhibition' THEN 'ip_popup'::genre
  ELSE 'artist_celebrity'::genre
END
WHERE genre::text IN (
  'musical',
  'concert',
  'play',
  'exhibition',
  'sports',
  'classic',
  'kids_family',
  'leisure_camping'
);
