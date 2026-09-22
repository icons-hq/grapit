# Consume one Ticket Item per field scan

Accepted 2026-09-22 for the full-service revamp, under the user's explicit autonomous implementation delegation. This is a product decision, not a claimed staff interview or physical rehearsal.

The July account/showtime batch-entry implementation admitted companions who had not arrived. Restore the seat-level unit intended by ADR 0001: a manually confirmed QR consumes only its Ticket Item. Another seat in the same reservation or a separate purchase remains independently usable. Preserve every historical admission timestamp and event; do not reverse earlier batch admissions or fabricate a per-seat scan history for them.

A scan's device attempt identifies one server receipt. Serialize retries, bind the receipt to the scanned ticket, requested showtime and scanner, and return the recorded result after a lost response. Competing attempts for the same seat have one successful admission. Serialize entry with cancellation through reservation, payment, Ticket Item and QR row locks, then recheck current validity. A signed cancelled or expired ticket is a validity rejection, not a forged credential.

Entry and physical benefit redemption remain separate ledgers and actions. The scanner bundle includes `field.scan.verify`, `field.scan.consume`, `field.scan.sync` and the separate `field.benefits.redeem` capability. Explicit custom capability lists require the latter to redeem; entry permission alone no longer grants redemption. First redemption attempts share the showtime lock with benefit configuration/live allocation so a concurrent edit cannot invalidate already used rights.

Local offline entry records are pending until server confirmation. Another device's successful admission yields a visible conflict; a retry of the same successful attempt yields the original receipt. Temporary server failures retain pending records for retry. Sync uses the authenticated scanner, scopes local records by scanner/showtime, and drops raw token material after terminal resolution. Offline benefit redemption is unavailable.

The UI requires the working showtime, accepts camera-opened QR links or manual QR input, displays seat identity before reservation context, and retains buyer QR access after entry. Actual camera/phone/network and physical stock handoff remain separate evidence gates.
