use sha256::digest;

global CAPACITY: u32 = 16;

// Public input order is part of the protocol; see src/lib/protocol.ts.
fn main(
    domain_hi: pub u128,
    domain_lo: pub u128,
    reserve: pub u64,
    max_amount: pub u64,
    count: pub u32,
    identities: pub [Field; CAPACITY],
    commitment_hi: pub [u128; CAPACITY],
    commitment_lo: pub [u128; CAPACITY],
    sale: pub bool,
    winner_index: pub u32,
    winner_identity: pub Field,
    price: pub u64,
    amounts: [u64; CAPACITY],
    nonces: [[u8; 32]; CAPACITY],
) {
    assert(count <= CAPACITY);
    assert(reserve <= max_amount);
    assert(max_amount > 0);
    let mut found = false;
    let mut best: u64 = 0;
    let mut index: u32 = 0;
    let mut identity: Field = 0;
    for i in 0..CAPACITY {
        if i < count {
            assert(identities[i] != 0);
            // Canonical address encoding is 160 bits, enforced by byte conversion.
            let address: [u8; 20] = identities[i].to_be_bytes();
            assert(Field::from_be_bytes(address) == identities[i]);
            assert(amounts[i] > 0);
            assert(amounts[i] <= max_amount);
            let mut message: [u8; 92] = [0; 92];
            let hi: [u8; 16] = (domain_hi as Field).to_be_bytes();
            let lo: [u8; 16] = (domain_lo as Field).to_be_bytes();
            let amount: [u8; 8] = (amounts[i] as Field).to_be_bytes();
            for j in 0..16 { message[j] = hi[j]; message[j + 16] = lo[j]; }
            for j in 0..20 { message[j + 32] = address[j]; }
            for j in 0..8 { message[j + 52] = amount[j]; }
            for j in 0..32 { message[j + 60] = nonces[i][j]; }
            let digest = digest(message);
            let mut digest_hi: u128 = 0;
            let mut digest_lo: u128 = 0;
            for j in 0..16 {
                digest_hi = digest_hi * 256 + digest[j] as u128;
                digest_lo = digest_lo * 256 + digest[j + 16] as u128;
            }
            assert(digest_hi == commitment_hi[i]);
            assert(digest_lo == commitment_lo[i]);
            if amounts[i] >= reserve & (!found | amounts[i] > best) {
                found = true;
                best = amounts[i];
                index = i;
                identity = identities[i];
            }
        } else {
            assert(identities[i] == 0);
            assert(commitment_hi[i] == 0);
            assert(commitment_lo[i] == 0);
            assert(amounts[i] == 0);
            assert(nonces[i] == [0; 32]);
        }
    }
    assert(sale == found);
    assert(winner_index == index);
    assert(winner_identity == identity);
    assert(price == best);
}

#[test]
fn zero_bids_no_sale() {
    main(1, 2, 10, 100, 0, [0;16], [0;16], [0;16], false, 0, 0, 0, [0;16], [[0;32];16]);
}

#[test(should_fail)]
fn no_sale_cannot_claim_a_winner() {
    main(1, 2, 10, 100, 0, [0;16], [0;16], [0;16], true, 0, 1, 20, [0;16], [[0;32];16]);
}

#[test(should_fail)]
fn padded_identity_is_rejected() {
    let mut identities = [0;16]; identities[15] = 1;
    main(1, 2, 10, 100, 0, identities, [0;16], [0;16], false, 0, 0, 0, [0;16], [[0;32];16]);
}

#[test(should_fail)]
fn padded_commitment_is_rejected() {
    let mut commitments = [0;16]; commitments[15] = 1;
    main(1, 2, 10, 100, 0, [0;16], commitments, [0;16], false, 0, 0, 0, [0;16], [[0;32];16]);
}

#[test(should_fail)]
fn padded_amount_is_rejected() {
    let mut amounts = [0;16]; amounts[15] = 1;
    main(1, 2, 10, 100, 0, [0;16], [0;16], [0;16], false, 0, 0, 0, amounts, [[0;32];16]);
}

#[test(should_fail)]
fn padded_nonce_is_rejected() {
    let mut nonces = [[0;32];16]; nonces[15][0] = 1;
    main(1, 2, 10, 100, 0, [0;16], [0;16], [0;16], false, 0, 0, 0, [0;16], nonces);
}

#[test(should_fail)]
fn count_over_capacity_is_rejected() {
    main(1, 2, 10, 100, 17, [0;16], [0;16], [0;16], false, 0, 0, 0, [0;16], [[0;32];16]);
}
