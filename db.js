const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function probarConexionDB() {
  try {
    const result = await pool.query("SELECT NOW() AS fecha_actual");
    console.log("Base de datos Supabase conectada:", result.rows[0].fecha_actual);
  } catch (error) {
    console.log("Error conectando a Supabase:", error.message);
  }
}

async function obtenerPlacaDesdeDB(uid) {
  try {
    const result = await pool.query(
      "SELECT placa FROM vehiculos WHERE uid = $1",
      [uid]
    );

    if (result.rows.length === 0) {
      return `PLACA-${uid.slice(-4)}`;
    }

    return result.rows[0].placa;
  } catch (error) {
    console.log("Error obteniendo placa:", error.message);
    return `PLACA-${uid.slice(-4)}`;
  }
}

async function guardarMovimiento(movimiento) {
  try {
    await pool.query(
      `
      INSERT INTO movimientos (
        uid,
        placa,
        tipo,
        espacio,
        hora_entrada,
        hora_salida,
        minutos,
        monto,
        mensaje
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        movimiento.uid,
        movimiento.placa,
        movimiento.tipo,
        movimiento.espacio,
        movimiento.horaEntrada,
        movimiento.horaSalida,
        movimiento.minutos,
        movimiento.monto,
        movimiento.mensaje
      ]
    );

    console.log("Movimiento guardado en Supabase");
  } catch (error) {
    console.log("Error guardando movimiento:", error.message);
  }
}

module.exports = {
  pool,
  probarConexionDB,
  obtenerPlacaDesdeDB,
  guardarMovimiento
};