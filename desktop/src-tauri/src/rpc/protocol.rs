use serde_json::Value;
use std::{error::Error, fmt};

#[derive(Debug, PartialEq, Eq)]
pub enum ProtocolError {
    InvalidJson { message: String },
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidJson { message } => {
                write!(formatter, "invalid Pi RPC JSON frame: {message}")
            }
        }
    }
}

impl Error for ProtocolError {}

#[derive(Default)]
pub struct JsonlDecoder {
    buffer: Vec<u8>,
}

impl JsonlDecoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Value>, ProtocolError> {
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();

        while let Some(newline_index) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut frame = self.buffer.drain(..=newline_index).collect::<Vec<_>>();
            frame.pop();
            if frame.last() == Some(&b'\r') {
                frame.pop();
            }
            frames.push(parse_frame(&frame)?);
        }

        Ok(frames)
    }
}

pub fn decode_jsonl_frames(bytes: &[u8]) -> Result<Vec<Value>, ProtocolError> {
    JsonlDecoder::default().push(bytes)
}

fn parse_frame(frame: &[u8]) -> Result<Value, ProtocolError> {
    serde_json::from_slice(frame).map_err(|error| ProtocolError::InvalidJson {
        message: error.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{decode_jsonl_frames, JsonlDecoder, ProtocolError};

    #[test]
    fn decodes_complete_lf_delimited_json_frames() {
        let frames =
            decode_jsonl_frames(b"{\"type\":\"message_update\"}\n{\"type\":\"agent_end\"}\n")
                .unwrap();

        assert_eq!(
            frames,
            vec![
                json!({ "type": "message_update" }),
                json!({ "type": "agent_end" })
            ]
        );
    }

    #[test]
    fn retains_an_incomplete_frame_until_its_lf_arrives() {
        let mut decoder = JsonlDecoder::default();

        assert!(decoder
            .push(b"{\"type\":\"message_update\"}\n{\"type\":\"agent_end\"}")
            .unwrap()
            .eq(&vec![json!({ "type": "message_update" })]));
        assert_eq!(
            decoder.push(b"\n").unwrap(),
            vec![json!({ "type": "agent_end" })]
        );
    }

    #[test]
    fn accepts_crlf_by_removing_only_the_cr_before_lf() {
        assert_eq!(
            decode_jsonl_frames(b"{\"type\":\"agent_end\"}\r\n").unwrap(),
            vec![json!({ "type": "agent_end" })]
        );
    }

    #[test]
    fn rejects_invalid_json_in_a_complete_frame() {
        let error = decode_jsonl_frames(b"not-json\n").unwrap_err();

        assert!(matches!(error, ProtocolError::InvalidJson { .. }));
    }
}
