env "sqlmodel" {
  src = getenv("SHEEP_ATLAS_SCHEMA")
  url = getenv("SHEEP_ATLAS_DATABASE")
  dev = getenv("SHEEP_ATLAS_DEV")
  migration {
    dir = "file://migrations"
  }
}
