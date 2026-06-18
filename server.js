require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const {
  pool,
  probarConexionDB,
  obtenerPlacaDesdeDB,
  guardarMovimiento
} = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT || 5000);

const endpoint = process.env.AWS_IOT_ENDPOINT;
const clientId = process.env.AWS_IOT_CLIENT_ID;
const topicScan = process.env.AWS_IOT_TOPIC || "parking/entrada/scan";
const topicComando = "parking/entrada/comando";

const RATE_PER_MINUTE = Number(process.env.RATE_PER_MINUTE || 1);
const READ_COOLDOWN_SECONDS = Number(process.env.READ_COOLDOWN_SECONDS || 8);
const READ_COOLDOWN_MS = READ_COOLDOWN_SECONDS * 1000;

const TOTAL_ESPACIOS = 10;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ===============================
// Estado del estacionamiento
// ===============================

const espacios = [
  { id: 1, estado: "libre", uid: null, placa: null, horaEntrada: null, horaEntradaTexto: null },
  { id: 2, estado: "libre", uid: null, placa: null, horaEntrada: null, horaEntradaTexto: null },
  { id: 3, estado: "libre", uid: null, placa: null, horaEntrada: null, horaEntradaTexto: null },
  { id: 4, estado: "libre", uid: null, placa: null, horaEntrada: null, horaEntradaTexto: null },
  { id: 5, estado: "libre", uid: null, placa: null, horaEntrada: null, horaEntradaTexto: null },
  { id: 6, estado: "libre", uid: null, placa: null, horaEntrada: null, horaEntradaTexto: null },
  { id: 7, estado: "libre", uid: null, placa: null, horaEntrada: null, horaEntradaTexto: null },
  { id: 8, estado: "libre", uid: null, placa: null, horaEntrada: null, horaEntradaTexto: null },
  { id: 9, estado: "libre", uid: null, placa: null, horaEntrada: null, horaEntradaTexto: null },
  { id: 10, estado: "libre", uid: null, placa: null, horaEntrada: null, horaEntradaTexto: null }
];

const reportes = {
  autosIngresados: 0,
  autosSalidos: 0,
  ingresosDia: 0,
  intentosSinEspacio: 0
};

const ultimasLecturas = {};
const movimientos = [];

let awsConectado = false;
let mqttClient = null;

// ===============================
// Utilidades
// ===============================

function obtenerHoraActual() {
  return new Date().toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function normalizarUID(uid) {
  return String(uid || "").replace(/\s+/g, "").toUpperCase();
}

function buscarEspacioPorUID(uid) {
  return espacios.find((espacio) => espacio.uid === uid);
}

function buscarPrimerEspacioLibre() {
  return espacios.find((espacio) => espacio.estado === "libre");
}

function calcularMinutos(horaEntrada) {
  const ahora = Date.now();
  const diferenciaMs = ahora - horaEntrada;

  return Math.max(1, Math.ceil(diferenciaMs / 60000));
}

function contarLibres() {
  return espacios.filter((e) => e.estado === "libre").length;
}

function agregarMovimiento(tipo, texto, uid, placa, espacio = null, monto = null, minutos = null) {
  movimientos.unshift({
    hora: obtenerHoraActual(),
    tipo,
    texto,
    uid,
    placa,
    espacio,
    monto,
    minutos
  });

  if (movimientos.length > 15) {
    movimientos.pop();
  }
}

function obtenerEstado() {
  return {
    awsConectado,
    tarifa: RATE_PER_MINUTE,
    cooldown: READ_COOLDOWN_SECONDS,
    total: TOTAL_ESPACIOS,
    espacios,
    reportes,
    movimientos,
    disponibles: contarLibres()
  };
}

function emitirEstado() {
  io.emit("estado", obtenerEstado());
}

// ===============================
// Enviar comando al ESP32
// ===============================

function publicarComandoESP32(comando) {
  if (!mqttClient || !mqttClient.connected) {
    console.log("No se pudo enviar comando: MQTT no conectado");
    return;
  }

  const payload = JSON.stringify(comando);

  console.log("Publicando comando al ESP32:");
  console.log("Topic:", topicComando);
  console.log("Payload:", payload);

  mqttClient.publish(topicComando, payload, (err) => {
    if (err) {
      console.log("Error publicando comando:", err.message);
    } else {
      console.log("Comando enviado al ESP32 correctamente");
    }
  });
}

// ===============================
// Lógica principal RFID
// ===============================

async function procesarLecturaRFID(uidOriginal) {
  const uid = normalizarUID(uidOriginal);
  const ahora = Date.now();

  if (!uid) {
    console.log("UID inválido. Lectura ignorada.");
    return;
  }

  if (ultimasLecturas[uid] && ahora - ultimasLecturas[uid] < READ_COOLDOWN_MS) {
    console.log("--------------------------------------");
    console.log("Lectura repetida ignorada en backend");
    console.log(`UID: ${uid}`);
    console.log(`Cooldown: ${READ_COOLDOWN_SECONDS} segundos`);
    console.log("--------------------------------------");
    return;
  }

  ultimasLecturas[uid] = ahora;

  const placa = await obtenerPlacaDesdeDB(uid);

  console.log("--------------------------------------");
  console.log(`UID recibido: ${uid}`);
  console.log(`Placa: ${placa}`);
  console.log(`Hora lectura: ${obtenerHoraActual()}`);

  const espacioOcupado = buscarEspacioPorUID(uid);

  // ===============================
  // CASO 1: SALIDA / PAGO
  // ===============================
  if (espacioOcupado) {
    const minutos = calcularMinutos(espacioOcupado.horaEntrada);
    const monto = minutos * RATE_PER_MINUTE;
    const espacioLiberado = espacioOcupado.id;

    console.log("Evento detectado: SALIDA / PAGO AUTOMÁTICO");
    console.log(`Espacio liberado: ${espacioLiberado}`);
    console.log(`Tiempo estacionado: ${minutos} minuto(s)`);
    console.log(`Monto pagado: S/ ${monto.toFixed(2)}`);

    agregarMovimiento(
      "salida",
      `Salida y pago automático. Tiempo: ${minutos} min. Total: S/ ${monto.toFixed(2)}`,
      uid,
      placa,
      espacioLiberado,
      monto,
      minutos
    );

    await guardarMovimiento({
      uid,
      placa,
      tipo: "salida",
      espacio: espacioLiberado,
      horaEntrada: new Date(espacioOcupado.horaEntrada),
      horaSalida: new Date(ahora),
      minutos,
      monto: Number(monto.toFixed(2)),
      mensaje: "Salida y pago automático"
    });

    espacioOcupado.estado = "libre";
    espacioOcupado.uid = null;
    espacioOcupado.placa = null;
    espacioOcupado.horaEntrada = null;
    espacioOcupado.horaEntradaTexto = null;

    reportes.autosSalidos++;
    reportes.ingresosDia += monto;

    const disponibles = contarLibres();

    publicarComandoESP32({
      uid,
      placa,
      accion: "salida",
      espacio: espacioLiberado,
      disponibles,
      total: TOTAL_ESPACIOS,
      minutos,
      monto: Number(monto.toFixed(2)),
      mensaje: "PAGO_REALIZADO"
    });

    emitirEstado();
    return;
  }

  // ===============================
  // CASO 2: ENTRADA
  // ===============================

  const espacioLibre = buscarPrimerEspacioLibre();

  if (!espacioLibre) {
    console.log("Evento detectado: ENTRADA DENEGADA");
    console.log("Motivo: no hay espacios disponibles");

    reportes.intentosSinEspacio++;

    agregarMovimiento(
      "denegado",
      "Entrada denegada. No hay espacios disponibles.",
      uid,
      placa
    );

    await guardarMovimiento({
      uid,
      placa,
      tipo: "denegado",
      espacio: null,
      horaEntrada: null,
      horaSalida: null,
      minutos: 0,
      monto: 0,
      mensaje: "Entrada denegada. No hay espacios disponibles."
    });

    publicarComandoESP32({
      uid,
      placa,
      accion: "denegado",
      espacio: 0,
      disponibles: 0,
      total: TOTAL_ESPACIOS,
      mensaje: "SIN_ESPACIOS"
    });

    emitirEstado();
    return;
  }

  espacioLibre.estado = "ocupado";
  espacioLibre.uid = uid;
  espacioLibre.placa = placa;
  espacioLibre.horaEntrada = ahora;
  espacioLibre.horaEntradaTexto = obtenerHoraActual();

  reportes.autosIngresados++;

  console.log("Evento detectado: ENTRADA");
  console.log(`Espacio asignado: ${espacioLibre.id}`);
  console.log(`Hora de entrada: ${espacioLibre.horaEntradaTexto}`);
  console.log(`Tarifa: S/ ${RATE_PER_MINUTE.toFixed(2)} por minuto`);

  agregarMovimiento(
    "entrada",
    `Entrada registrada. Espacio asignado: ${espacioLibre.id}`,
    uid,
    placa,
    espacioLibre.id,
    0,
    0
  );

  await guardarMovimiento({
    uid,
    placa,
    tipo: "entrada",
    espacio: espacioLibre.id,
    horaEntrada: new Date(ahora),
    horaSalida: null,
    minutos: 0,
    monto: 0,
    mensaje: `Entrada registrada. Espacio asignado: ${espacioLibre.id}`
  });

  const disponibles = contarLibres();

  publicarComandoESP32({
    uid,
    placa,
    accion: "entrada",
    espacio: espacioLibre.id,
    disponibles,
    total: TOTAL_ESPACIOS,
    mensaje: "DIRIGIR_ESPACIO"
  });

  emitirEstado();
}

// ===============================
// API
// ===============================

app.get("/api/estado", (req, res) => {
  res.json(obtenerEstado());
});

app.get("/api/historial", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM movimientos
      ORDER BY creado_en DESC
      LIMIT 50
    `);

    res.json(result.rows);
  } catch (error) {
    console.log("Error obteniendo historial:", error.message);

    res.status(500).json({
      error: "Error obteniendo historial",
      detalle: error.message
    });
  }
});

// ===============================
// REPORTES DESDE SUPABASE
// ===============================

app.get("/api/reportes", async (req, res) => {
  try {
    const ingresosDia = await pool.query(`
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM movimientos
      WHERE tipo = 'salida'
      AND (creado_en AT TIME ZONE 'America/Lima')::date =
          (NOW() AT TIME ZONE 'America/Lima')::date
    `);

    const ingresosSemana = await pool.query(`
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM movimientos
      WHERE tipo = 'salida'
      AND (creado_en AT TIME ZONE 'America/Lima') >=
          date_trunc('week', NOW() AT TIME ZONE 'America/Lima')
    `);

    const ingresosMes = await pool.query(`
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM movimientos
      WHERE tipo = 'salida'
      AND (creado_en AT TIME ZONE 'America/Lima') >=
          date_trunc('month', NOW() AT TIME ZONE 'America/Lima')
    `);

    const ingresosPorDia = await pool.query(`
      SELECT
        TO_CHAR((creado_en AT TIME ZONE 'America/Lima')::date, 'DD/MM') AS dia,
        COALESCE(SUM(monto), 0) AS total
      FROM movimientos
      WHERE tipo = 'salida'
      AND (creado_en AT TIME ZONE 'America/Lima')::date >=
          (NOW() AT TIME ZONE 'America/Lima')::date - INTERVAL '6 days'
      GROUP BY (creado_en AT TIME ZONE 'America/Lima')::date
      ORDER BY (creado_en AT TIME ZONE 'America/Lima')::date ASC
    `);

    const autosIngresadosDia = await pool.query(`
      SELECT COUNT(*) AS total
      FROM movimientos
      WHERE tipo = 'entrada'
      AND (creado_en AT TIME ZONE 'America/Lima')::date =
          (NOW() AT TIME ZONE 'America/Lima')::date
    `);

    const autosSalidosDia = await pool.query(`
      SELECT COUNT(*) AS total
      FROM movimientos
      WHERE tipo = 'salida'
      AND (creado_en AT TIME ZONE 'America/Lima')::date =
          (NOW() AT TIME ZONE 'America/Lima')::date
    `);

    res.json({
      ingresosDia: Number(ingresosDia.rows[0].total),
      ingresosSemana: Number(ingresosSemana.rows[0].total),
      ingresosMes: Number(ingresosMes.rows[0].total),
      autosIngresadosDia: Number(autosIngresadosDia.rows[0].total),
      autosSalidosDia: Number(autosSalidosDia.rows[0].total),
      tarifa: RATE_PER_MINUTE,
      ingresosPorDia: ingresosPorDia.rows.map((fila) => ({
        dia: fila.dia,
        total: Number(fila.total)
      }))
    });
  } catch (error) {
    console.log("Error obteniendo reportes:", error.message);

    res.status(500).json({
      error: "Error obteniendo reportes",
      detalle: error.message
    });
  }
});

app.post("/api/reset", (req, res) => {
  espacios.forEach((espacio) => {
    espacio.estado = "libre";
    espacio.uid = null;
    espacio.placa = null;
    espacio.horaEntrada = null;
    espacio.horaEntradaTexto = null;
  });

  reportes.autosIngresados = 0;
  reportes.autosSalidos = 0;
  reportes.ingresosDia = 0;
  reportes.intentosSinEspacio = 0;

  movimientos.length = 0;

  for (const uid in ultimasLecturas) {
    delete ultimasLecturas[uid];
  }

  publicarComandoESP32({
    uid: "",
    accion: "reset",
    espacio: 0,
    disponibles: TOTAL_ESPACIOS,
    total: TOTAL_ESPACIOS,
    mensaje: "SISTEMA_REINICIADO"
  });

  emitirEstado();

  res.json({ ok: true });
});

// ===============================
// Socket.IO
// ===============================

io.on("connection", (socket) => {
  socket.emit("estado", obtenerEstado());
});

// ===============================
// Conexión AWS IoT Core
// ===============================

console.log("======================================");
console.log("SMARTPARK BACKEND + DASHBOARD WEB");
console.log("======================================");
console.log("Endpoint:", endpoint);
console.log("Client ID:", clientId);
console.log("Topic scan:", topicScan);
console.log("Topic comando:", topicComando);
console.log("Tarifa:", `S/ ${RATE_PER_MINUTE.toFixed(2)} por minuto`);
console.log("Cooldown:", `${READ_COOLDOWN_SECONDS} segundos`);
console.log("======================================");

probarConexionDB();

mqttClient = mqtt.connect({
  protocol: "mqtts",
  host: endpoint,
  port: 8883,
  clientId: clientId,
  ca: fs.readFileSync(process.env.AWS_CA_PATH),
  cert: fs.readFileSync(process.env.AWS_CERT_PATH),
  key: fs.readFileSync(process.env.AWS_KEY_PATH),
  rejectUnauthorized: true,
  keepalive: 60,
  connectTimeout: 30000,
  reconnectPeriod: 3000
});

mqttClient.on("connect", () => {
  awsConectado = true;
  emitirEstado();

  console.log("Conectado a AWS IoT Core");

  mqttClient.subscribe(topicScan, (err) => {
    if (err) {
      console.log("Error al suscribirse:", err.message);
    } else {
      console.log("Suscrito correctamente al tópico:");
      console.log(topicScan);
      console.log("Abre la página en:");
      console.log(`http://localhost:${PORT}`);
    }
  });
});

mqttClient.on("message", async (receivedTopic, message) => {
  console.log("Mensaje recibido desde AWS IoT Core");

  try {
    const data = JSON.parse(message.toString());

    if (!data.uid) {
      console.log("El mensaje no tiene UID. Se ignora.");
      return;
    }

    await procesarLecturaRFID(data.uid);
  } catch (error) {
    console.log("Error al procesar mensaje:", error.message);
    console.log("Payload recibido:", message.toString());
  }
});

mqttClient.on("error", (error) => {
  awsConectado = false;
  emitirEstado();
  console.log("Error MQTT:", error.message);
});

mqttClient.on("close", () => {
  awsConectado = false;
  emitirEstado();
  console.log("Conexión MQTT cerrada");
});

// ===============================
// Servidor web
// ===============================

server.listen(PORT, () => {
  console.log(`Servidor web activo en http://localhost:${PORT}`);
});