// backend/server.js
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/get-databases", async (req, res) => {
  const { host, port, user, password } = req.body;
  console.log(req.body);
  const pool = new Pool({
    host,
    port,
    user,
    password,
  });

  try {
    const client = await pool.connect();
    const databases = await client.query(
      `SELECT datname FROM pg_database WHERE datistemplate = false;`
    );
    client.release();
    res.json({ databases: databases.rows });
  } catch (error) {
    console.error("Error fetching databases", error);
    res.status(500).send("Error fetching databases");
  }
});

app.post("/api/extract-metadata", async (req, res) => {
  const { host, port, database, user, password } = req.body;

//   if (database === 'rdsadmin') {
//     return res.status(400).json({
//       error: "The 'rdsadmin' database is managed by AWS and cannot be extracted."
//     });
//   }

  const pool = new Pool({
    host,
    port,
    database,
    user,
    password,
  });

  try {
    const client = await pool.connect();

    // Fetch schemas excluding system schemas
    const schemas = await client.query(
      `SELECT schema_name FROM information_schema.schemata 
           WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast');`
    );

    const schemaMetadata = await Promise.all(
      schemas.rows.map(async (schema) => {
        const tables = await client.query(
          `SELECT table_name FROM information_schema.tables 
               WHERE table_schema = $1;`,
          [schema.schema_name]
        );
        const storedProcedures = await client.query(
          `SELECT routine_name FROM information_schema.routines 
               WHERE routine_schema = $1 AND routine_type = 'PROCEDURE';`,
          [schema.schema_name]
        );
        const indexes = await client.query(
          `SELECT indexname FROM pg_indexes 
               WHERE schemaname = $1;`,
          [schema.schema_name]
        );
        const constraints = await client.query(
          `SELECT 
                conname AS constraint_name, 
                contype AS constraint_type, 
                conrelid::regclass AS table_name,
                a.attname AS column_name
              FROM pg_constraint AS c 
              JOIN pg_namespace AS ns ON ns.oid = c.connamespace
              JOIN pg_attribute AS a ON a.attnum = ANY(c.conkey)
              WHERE ns.nspname = $1;`,
          [schema.schema_name]
        );

        return {
          schema_name: schema.schema_name,
          tables: tables.rows,
          storedProcedures: storedProcedures.rows,
          indexes: indexes.rows,
          constraints: constraints.rows,
        };
      })
    );

    const dbSize = await client.query(`SELECT pg_database_size($1) AS size;`, [
      database,
    ]);

    client.release();

    res.json({
      datname: database,
      size: dbSize.rows[0].size,
      schemas: schemaMetadata,
    });
  } catch (error) {
    console.error("Error extracting metadata", error);
    res.status(500).send("Error extracting metadata");
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
