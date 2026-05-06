import pg from 'pg';
import argon2 from 'argon2';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

const GIRL_RULES_FANMEET_TITLE = '2026 걸룰스 팬미팅';
const DONGHAE_SEAT_MAP_URL = '/seed/donghae-girl-rules-20260718-seat-map.svg';

function expandSeatRanges(ranges) {
  return ranges.flatMap(([row, start, end]) =>
    Array.from({ length: end - start + 1 }, (_, index) => `${row}-${start + index}`)
  );
}

const donghaeFanmeetSeatConfig = {
  tiers: [
    {
      tierName: 'SVIP석',
      color: '#C026D3',
      seatIds: expandSeatRanges([
        ['가', 1, 168],
        ['나', 1, 176],
        ['나', 182, 187],
        ['다', 1, 182],
        ['라', 1, 168],
      ]),
    },
    {
      tierName: 'VIP석',
      color: '#EA580C',
      seatIds: expandSeatRanges([
        ['가', 169, 300],
        ['나', 177, 181],
        ['나', 188, 297],
        ['나', 306, 308],
        ['다', 183, 300],
        ['라', 169, 300],
      ]),
    },
    {
      tierName: 'R석',
      color: '#2563EB',
      seatIds: expandSeatRanges([
        ['가', 301, 324],
        ['가', 327, 336],
        ['나', 298, 305],
        ['다', 301, 319],
        ['라', 301, 333],
        ['마', 1, 181],
        ['바', 1, 172],
        ['사', 1, 172],
        ['아', 1, 181],
      ]),
    },
  ],
};

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Clean existing seed admin user (FK-safe order)
    await client.query("DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@grabit.test')");
    await client.query("DELETE FROM social_accounts WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@grabit.test')");
    await client.query("DELETE FROM terms_agreements WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@grabit.test')");
    await client.query("DELETE FROM users WHERE email = 'admin@grabit.test'");

    // Clean existing seed data (FK-safe order)
    await client.query('DELETE FROM payments');
    await client.query('DELETE FROM reservation_seats');
    await client.query('DELETE FROM reservations');
    await client.query('DELETE FROM seat_inventories');
    await client.query('DELETE FROM banners');
    await client.query('DELETE FROM castings');
    await client.query('DELETE FROM price_tiers');
    await client.query('DELETE FROM showtimes');
    await client.query('DELETE FROM seat_maps');
    await client.query('DELETE FROM performances');
    await client.query('DELETE FROM venues');

    console.log('Cleared existing data');

    // Admin user
    const adminPasswordHash = await argon2.hash('TestAdmin2026!', {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    await client.query(`
      INSERT INTO users (id, email, password_hash, name, phone, gender, country, birth_date, role, is_phone_verified, is_email_verified)
      VALUES (gen_random_uuid(), 'admin@grabit.test', $1, '관리자', '010-0000-0000', 'unspecified', 'KR', '1990-01-01', 'admin', true, true)
    `, [adminPasswordHash]);
    console.log('Inserted admin user: admin@grabit.test');

    // Venues
    const venueRows = await client.query(`
      INSERT INTO venues (id, name, address) VALUES
        (gen_random_uuid(), '블루스퀘어 인터파크홀', '서울 용산구 이태원로 294'),
        (gen_random_uuid(), '올림픽공원 체조경기장', '서울 송파구 올림픽로 424'),
        (gen_random_uuid(), '세종문화회관 대극장', '서울 종로구 세종대로 175'),
        (gen_random_uuid(), 'KINTEX 제1전시장', '경기 고양시 일산서구 킨텍스로 217-60'),
        (gen_random_uuid(), '예술의전당 오페라극장', '서울 서초구 남부순환로 2406'),
        (gen_random_uuid(), '동해문화예술관 대극장', NULL)
      RETURNING id, name
    `);
    const venues = Object.fromEntries(venueRows.rows.map(r => [r.name, r.id]));
    console.log(`Inserted ${venueRows.rows.length} venues`);

    // Performances
    const now = new Date();
    const perfData = [
      {
        title: '뮤지컬 〈오페라의 유령〉',
        genre: 'musical',
        subcategory: '라이선스',
        venue: '블루스퀘어 인터파크홀',
        poster: '/seed/poster/25012652_p.gif',
        description: '전 세계 1억 5천만 관객을 사로잡은 앤드루 로이드 웨버의 걸작. 파리 오페라 극장 지하에 숨어 사는 천재 음악가 팬텀과 소프라노 크리스틴의 비극적 사랑 이야기.',
        startDate: new Date(now.getTime() - 30 * 86400000).toISOString(),
        endDate: new Date(now.getTime() + 90 * 86400000).toISOString(),
        runtime: '160분 (인터미션 20분 포함)',
        ageRating: '8세 이상',
        status: 'selling',
        viewCount: 12450,
      },
      {
        title: '2026 IU 콘서트 \'The Golden Hour\'',
        genre: 'concert',
        subcategory: 'K-POP',
        venue: '올림픽공원 체조경기장',
        poster: '/seed/poster/25018106_p.gif',
        description: '아이유의 2026년 전국 투어 콘서트. 새 앨범 수록곡과 히트곡으로 구성된 3시간의 황금빛 무대.',
        startDate: new Date(now.getTime() + 14 * 86400000).toISOString(),
        endDate: new Date(now.getTime() + 16 * 86400000).toISOString(),
        runtime: '180분',
        ageRating: '전체 관람가',
        status: 'selling',
        viewCount: 34200,
      },
      {
        title: '연극 〈햄릿〉',
        genre: 'play',
        subcategory: '셰익스피어',
        venue: '세종문화회관 대극장',
        poster: '/seed/poster/26000685_p.gif',
        description: '셰익스피어의 4대 비극 중 최고 걸작. 덴마크 왕자 햄릿의 복수와 번민을 현대적으로 재해석한 화제의 프로덕션.',
        startDate: new Date(now.getTime() - 50 * 86400000).toISOString(),
        endDate: new Date(now.getTime() + 5 * 86400000).toISOString(),
        runtime: '150분 (인터미션 15분 포함)',
        ageRating: '13세 이상',
        status: 'closing_soon',
        viewCount: 8730,
      },
      {
        title: '전시 〈모네: 빛을 그리다〉',
        genre: 'exhibition',
        subcategory: '미술',
        venue: 'KINTEX 제1전시장',
        poster: '/seed/poster/26001001_p.gif',
        description: '인상파의 거장 클로드 모네의 대표작 120점을 몰입형 디지털 아트로 재현. 수련 연작 속을 걷는 듯한 체험형 전시.',
        startDate: new Date(now.getTime() + 30 * 86400000).toISOString(),
        endDate: new Date(now.getTime() + 120 * 86400000).toISOString(),
        runtime: '약 90분 (자유 관람)',
        ageRating: '전체 관람가',
        status: 'upcoming',
        viewCount: 5100,
      },
      {
        title: '뮤지컬 〈위키드〉',
        genre: 'musical',
        subcategory: '라이선스',
        venue: '예술의전당 오페라극장',
        poster: '/seed/poster/26001248_p.gif',
        description: '오즈의 마법사 그 이전 이야기. 착한 마녀 글린다와 나쁜 마녀 엘파바의 우정과 운명을 그린 브로드웨이 히트 뮤지컬.',
        startDate: new Date(now.getTime() - 120 * 86400000).toISOString(),
        endDate: new Date(now.getTime() - 10 * 86400000).toISOString(),
        runtime: '155분 (인터미션 20분 포함)',
        ageRating: '8세 이상',
        status: 'ended',
        viewCount: 21300,
      },
      {
        title: GIRL_RULES_FANMEET_TITLE,
        genre: 'concert',
        subcategory: '팬미팅',
        venue: '동해문화예술관 대극장',
        poster: null,
        description: '2026년 7월 18일 동해문화예술관 대극장에서 열리는 걸룰스 팬미팅.',
        startDate: new Date('2026-07-17T15:00:00.000Z').toISOString(),
        endDate: new Date('2026-07-18T14:59:59.000Z').toISOString(),
        runtime: '120분',
        ageRating: '전체 관람가',
        status: 'selling',
        viewCount: 0,
      },
    ];
    const girlRulesFanmeetIdx = perfData.findIndex((p) => p.title === GIRL_RULES_FANMEET_TITLE);

    const perfIds = [];
    for (const p of perfData) {
      const res = await client.query(`
        INSERT INTO performances (id, title, genre, subcategory, venue_id, poster_url, description, start_date, end_date, runtime, age_rating, status, view_count)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [p.title, p.genre, p.subcategory, venues[p.venue], p.poster, p.description, p.startDate, p.endDate, p.runtime, p.ageRating, p.status, p.viewCount]);
      perfIds.push({ id: res.rows[0].id, title: p.title });
    }
    console.log(`Inserted ${perfIds.length} performances`);

    // Showtimes (2~4 per performance, excluding ended)
    const showtimeInserts = [];
    for (let i = 0; i < 4; i++) {
      const perf = perfIds[i];
      const baseDate = i < 2 ? new Date(now.getTime() + (7 + i * 3) * 86400000) : new Date(now.getTime() + (i * 5) * 86400000);

      for (let s = 0; s < (i < 2 ? 3 : 2); s++) {
        const dt = new Date(baseDate.getTime() + s * 86400000);
        dt.setHours(s === 0 ? 14 : 19, 30, 0, 0);
        showtimeInserts.push(client.query(
          'INSERT INTO showtimes (id, performance_id, date_time) VALUES (gen_random_uuid(), $1, $2)',
          [perf.id, dt.toISOString()]
        ));
      }
    }
    showtimeInserts.push(client.query(
      'INSERT INTO showtimes (id, performance_id, date_time) VALUES (gen_random_uuid(), $1, $2)',
      [perfIds[girlRulesFanmeetIdx].id, new Date('2026-07-18T05:00:00.000Z').toISOString()]
    ));
    await Promise.all(showtimeInserts);
    console.log(`Inserted ${showtimeInserts.length} showtimes`);

    // Price tiers
    const tierData = [
      { idx: 0, tiers: [{ name: 'VIP석', price: 170000 }, { name: 'R석', price: 140000 }, { name: 'S석', price: 110000 }, { name: 'A석', price: 80000 }] },
      { idx: 1, tiers: [{ name: 'VIP석', price: 165000 }, { name: 'R석', price: 132000 }, { name: 'S석', price: 99000 }] },
      { idx: 2, tiers: [{ name: 'R석', price: 60000 }, { name: 'S석', price: 40000 }, { name: 'A석', price: 25000 }] },
      { idx: 3, tiers: [{ name: '일반', price: 20000 }, { name: '청소년', price: 15000 }] },
      { idx: 4, tiers: [{ name: 'VIP석', price: 150000 }, { name: 'R석', price: 120000 }, { name: 'S석', price: 90000 }] },
      { idx: girlRulesFanmeetIdx, tiers: [{ name: 'SVIP석', price: 380000 }, { name: 'VIP석', price: 260000 }, { name: 'R석', price: 120000 }] },
    ];
    const tierInserts = [];
    for (const { idx, tiers } of tierData) {
      for (let t = 0; t < tiers.length; t++) {
        tierInserts.push(client.query(
          'INSERT INTO price_tiers (id, performance_id, tier_name, price, sort_order) VALUES (gen_random_uuid(), $1, $2, $3, $4)',
          [perfIds[idx].id, tiers[t].name, tiers[t].price, t]
        ));
      }
    }
    await Promise.all(tierInserts);
    console.log(`Inserted ${tierInserts.length} price tiers`);

    // Castings
    const castingData = [
      { idx: 0, casts: [
        { actor: '김준수', role: '팬텀' },
        { actor: '손승원', role: '크리스틴' },
        { actor: '정성화', role: '라울' },
      ]},
      { idx: 1, casts: [
        { actor: '아이유', role: null },
      ]},
      { idx: 2, casts: [
        { actor: '남궁민', role: '햄릿' },
        { actor: '이하나', role: '오필리어' },
        { actor: '유해진', role: '클로디어스' },
      ]},
      { idx: 4, casts: [
        { actor: '옥주현', role: '엘파바' },
        { actor: '이지혜', role: '글린다' },
      ]},
      { idx: girlRulesFanmeetIdx, casts: [
        { actor: '걸룰스', role: '아티스트' },
      ]},
    ];
    const castInserts = [];
    for (const { idx, casts } of castingData) {
      for (let c = 0; c < casts.length; c++) {
        castInserts.push(client.query(
          'INSERT INTO castings (id, performance_id, actor_name, role_name, sort_order) VALUES (gen_random_uuid(), $1, $2, $3, $4)',
          [perfIds[idx].id, casts[c].actor, casts[c].role, c]
        ));
      }
    }
    await Promise.all(castInserts);
    console.log(`Inserted ${castInserts.length} castings`);

    // Seat maps (for selling/closing_soon performances that have showtimes)
    const seatMapConfig = (tiers) => {
      // Map tier names to seat rows from sample-seat-map.svg
      const tierMapping = {
        'VIP석': ['A-1','A-2','A-3','A-4','A-5','A-6','A-7','A-8','A-9','A-10'],
        'R석': ['B-1','B-2','B-3','B-4','B-5','B-6','B-7','B-8','B-9','B-10'],
        'S석': ['C-1','C-2','C-3','C-4','C-5','C-6','C-7','C-8','C-9','C-10','C-11','C-12','D-1','D-2','D-3','D-4','D-5','D-6','D-7','D-8','D-9','D-10','D-11','D-12'],
        'A석': ['E-1','E-2','E-3','E-4','E-5','E-6','E-7','E-8','E-9','E-10','E-11','E-12','E-13','E-14','F-1','F-2','F-3','F-4','F-5','F-6','F-7','F-8','F-9','F-10','F-11','F-12','F-13','F-14'],
        '일반': ['A-1','A-2','A-3','A-4','A-5','A-6','A-7','A-8','A-9','A-10','B-1','B-2','B-3','B-4','B-5','B-6','B-7','B-8','B-9','B-10','C-1','C-2','C-3','C-4','C-5','C-6','C-7','C-8','C-9','C-10','C-11','C-12','D-1','D-2','D-3','D-4','D-5','D-6','D-7','D-8','D-9','D-10','D-11','D-12'],
        '청소년': ['E-1','E-2','E-3','E-4','E-5','E-6','E-7','E-8','E-9','E-10','E-11','E-12','E-13','E-14','F-1','F-2','F-3','F-4','F-5','F-6','F-7','F-8','F-9','F-10','F-11','F-12','F-13','F-14'],
      };
      const tierColors = { 'VIP석': '#6C3CE0', 'R석': '#2563EB', 'S석': '#16A34A', 'A석': '#F59E0B', '일반': '#2563EB', '청소년': '#16A34A' };

      return {
        tiers: tiers.map(t => ({
          tierName: t,
          color: tierColors[t] || '#6B7280',
          seatIds: tierMapping[t] || [],
        })),
      };
    };

    // Add seat maps for first 3 performances (selling + closing_soon)
    const seatMapPerfs = [
      { idx: 0, tiers: ['VIP석', 'R석', 'S석', 'A석'] },
      { idx: 1, tiers: ['VIP석', 'R석', 'S석'] },
      { idx: 2, tiers: ['R석', 'S석', 'A석'] },
      {
        idx: girlRulesFanmeetIdx,
        config: donghaeFanmeetSeatConfig,
        svgUrl: DONGHAE_SEAT_MAP_URL,
      },
    ];
    for (const sm of seatMapPerfs) {
      const config = sm.config ?? seatMapConfig(sm.tiers);
      const totalSeats = config.tiers.reduce((sum, t) => sum + t.seatIds.length, 0);
      await client.query(
        'INSERT INTO seat_maps (id, performance_id, svg_url, seat_config, total_seats) VALUES (gen_random_uuid(), $1, $2, $3, $4)',
        [perfIds[sm.idx].id, sm.svgUrl ?? '/seed/sample-seat-map.svg', JSON.stringify(config), totalSeats]
      );
    }
    console.log(`Inserted ${seatMapPerfs.length} seat maps`);

    // Banners
    const bannerData = [
      { image: '/seed/banners/260324015208_26003900.gif', link: null, sort: 0 },
      { image: '/seed/banners/260330090702_26004771.gif', link: null, sort: 1 },
      { image: '/seed/banners/260330101328_26003180.gif', link: null, sort: 2 },
    ];
    for (const b of bannerData) {
      await client.query(
        'INSERT INTO banners (id, image_url, link_url, sort_order, is_active) VALUES (gen_random_uuid(), $1, $2, $3, true)',
        [b.image, b.link, b.sort]
      );
    }
    console.log(`Inserted ${bannerData.length} banners`);

    // Link banners to performances (linkUrl)
    await client.query(
      `UPDATE banners SET link_url = '/performance/' || $1 WHERE sort_order = 0`,
      [perfIds[0].id]
    );
    await client.query(
      `UPDATE banners SET link_url = '/performance/' || $1 WHERE sort_order = 1`,
      [perfIds[1].id]
    );
    await client.query(
      `UPDATE banners SET link_url = '/performance/' || $1 WHERE sort_order = 2`,
      [perfIds[2].id]
    );

    await client.query('COMMIT');
    console.log('\nSeed complete!');
    console.log('Performances:');
    for (const p of perfIds) {
      console.log(`  - ${p.title} (${p.id})`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
