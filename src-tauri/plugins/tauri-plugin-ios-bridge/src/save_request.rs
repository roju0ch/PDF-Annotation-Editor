const MAX_BYTES: usize = 150 * 1024 * 1024;
const CHUNK_BYTES: usize = 256 * 1024;

pub(crate) fn valid_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

pub(crate) fn valid_begin(file_name: &str, byte_length: usize) -> bool {
    (5..=MAX_BYTES).contains(&byte_length) && file_name.len() <= 1024
}

pub(crate) fn valid_append(token: &str, offset: usize, encoded_length: usize) -> bool {
    valid_id(token)
        && offset < MAX_BYTES
        && (1..=4 * CHUNK_BYTES.div_ceil(3)).contains(&encoded_length)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "12345678-1234-1234-ABCD-123456789abc";

    #[test]
    fn accepts_opaque_uuids_and_rejects_paths_and_lookalikes() {
        assert!(valid_id(TOKEN));
        for invalid in [
            "../../file.pdf",
            "12345678-1234-1234-ABCD-Z23456789abc",
            "1234567812341234ABCD123456789abc",
        ] {
            assert!(!valid_id(invalid));
        }
    }

    #[test]
    fn bounds_pdf_size_and_encoded_chunk_before_ipc() {
        assert!(valid_begin("Plan Ä.pdf", MAX_BYTES));
        assert!(!valid_begin("Plan.pdf", MAX_BYTES + 1));
        assert!(!valid_begin("Plan.pdf", 4));
        assert!(!valid_begin(&"ä".repeat(513), 5));

        let max_encoded = 4 * CHUNK_BYTES.div_ceil(3);
        assert!(valid_append(TOKEN, MAX_BYTES - 1, max_encoded));
        assert!(!valid_append(TOKEN, MAX_BYTES, max_encoded));
        assert!(!valid_append(TOKEN, 0, max_encoded + 1));
        assert!(!valid_append(TOKEN, 0, 0));
        assert!(!valid_append("local.pdf", 0, 8));
    }
}
