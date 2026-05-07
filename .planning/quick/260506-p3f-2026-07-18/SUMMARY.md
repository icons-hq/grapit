---
status: complete
completed: 2026-05-06
quick_id: 260506-p3f
slug: 2026-07-18
---

# Summary

Deleted production test performance data while preserving the 2026-07-18 Girl Rules performance.

## Deleted

- performances: 4
- showtimes: 7
- seat maps: 2
- seat inventories: 1
- price tiers: 11
- castings: 6
- reservations: 1
- reservation seats: 1
- payments: 1

Deleted performance titles:

- 뮤지컬 〈위키드〉
- 2026 IU 콘서트 'The Golden Hour'
- 연극 〈햄릿〉
- 전시 〈모네: 빛을 그리다〉

## Preserved

- `18a3bcc6-5e75-463d-abfd-634601328754` — Girl Rules FAN MEETING IN SEOUL
- Showtime remains: 2026-07-18T14:00:00.000Z
- Seat map remains attached.
- Banner remains attached to the Girl Rules performance.

## Verification

- Direct production DB query after deletion shows exactly 1 remaining performance.
- Public detail API `/api/v1/performances/18a3bcc6-5e75-463d-abfd-634601328754` returns the Girl Rules performance with price tiers, showtime, and seat map.
