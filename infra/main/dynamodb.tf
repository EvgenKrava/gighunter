resource "aws_dynamodb_table" "main" {
  name         = var.project
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }
  attribute {
    name = "gsi2pk"
    type = "S"
  }
  attribute {
    name = "gsi2sk"
    type = "S"
  }

  global_secondary_index {
    name = "gsi1"
    key_schema {
      attribute_name = "gsi1pk"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "gsi1sk"
      key_type       = "RANGE"
    }
    projection_type = "KEYS_ONLY"
  }

  global_secondary_index {
    name = "gsi2"
    key_schema {
      attribute_name = "gsi2pk"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "gsi2sk"
      key_type       = "RANGE"
    }
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Off on purpose: data is disposable (TTL) and PITR bills backup storage.
  point_in_time_recovery { enabled = false }
}
