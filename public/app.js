const socket = io();

let ultimoEstado = null;

const placasPorUID = {
  "5093DD61": "ABC-123",
  "19576B06": "T1F-456",
  "60C8BF61": "B7K-890",
  "279A6C06": "H2M-321"
};

function obtenerPlaca(uid, placaBackend = null) {
  if (placaBackend) return placaBackend;
  if (!uid) return "-";

  const uidTexto = String(uid);
  return placasPorUID[uidTexto] || `PLACA-${uidTexto.slice(-4)}`;
}

function formatoSoles(valor) {
  return `S/ ${Number(valor || 0).toFixed(2)}`;
}

function obtenerTimestamp(horaEntrada) {
  if (!horaEntrada) return null;

  if (typeof horaEntrada === "number") {
    return horaEntrada;
  }

  const fecha = new Date(horaEntrada).getTime();

  if (Number.isNaN(fecha)) {
    return null;
  }

  return fecha;
}

function calcularMinutosCobro(horaEntrada) {
  const timestamp = obtenerTimestamp(horaEntrada);

  if (!timestamp) return 0;

  const diferencia = Date.now() - timestamp;

  if (diferencia <= 0) return 1;

  return Math.max(1, Math.ceil(diferencia / 60000));
}

function calcularMontoActual(horaEntrada, tarifaPorMinuto) {
  const minutos = calcularMinutosCobro(horaEntrada);
  return minutos * Number(tarifaPorMinuto || 0);
}

function formatearFecha(valor) {
  if (!valor) return "-";

  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return "-";
  }

  return fecha.toLocaleString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatearHora(valor) {
  if (!valor) return "-";

  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return "-";
  }

  return fecha.toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

/* ===============================
   RENDER GENERAL
================================ */

function renderizarEstado(data) {
  ultimoEstado = data;

  renderizarEstadoAws(data);
  renderizarResumen(data);
  renderizarEspacios(data);
  renderizarMovimientosEnVivo(data.movimientos || []);
}

function renderizarEstadoAws(data) {
  const estadoAws = document.getElementById("estadoAws");

  if (!estadoAws) return;

  if (data.awsConectado) {
    estadoAws.innerHTML = `<i class="fa-solid fa-circle-check"></i> AWS IoT Conectado`;
    estadoAws.className = "aws-badge connected";
  } else {
    estadoAws.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> AWS IoT Desconectado`;
    estadoAws.className = "aws-badge disconnected";
  }
}

function renderizarResumen(data) {
  const reportes = data.reportes || {};

  const autosIngresados = document.getElementById("autosIngresados");
  const autosSalidos = document.getElementById("autosSalidos");
  const ingresosDia = document.getElementById("ingresosDia");
  const disponibles = document.getElementById("disponibles");

  if (autosIngresados) {
    autosIngresados.textContent = reportes.autosIngresados || 0;
  }

  if (autosSalidos) {
    autosSalidos.textContent = reportes.autosSalidos || 0;
  }

  if (ingresosDia) {
    ingresosDia.textContent = formatoSoles(reportes.ingresosDia || 0);
  }

  if (disponibles) {
    disponibles.textContent = `${data.disponibles || 0} / ${data.total || 10}`;
  }
}

/* ===============================
   ESPACIOS
================================ */

function renderizarEspacios(data) {
  const espacios = data.espacios || [];

  const contenedores = [
    document.getElementById("contenedorEspacios"),
    document.getElementById("contenedorEspaciosVista")
  ].filter(Boolean);

  if (contenedores.length === 0) return;

  if (espacios.length === 0) {
    contenedores.forEach((contenedor) => {
      contenedor.innerHTML = `
        <div class="empty-message">
          No hay espacios registrados.
        </div>
      `;
    });

    return;
  }

  const html = espacios.map((espacio) => {
    const estaLibre = espacio.estado === "libre";
    const minutosCobro = calcularMinutosCobro(espacio.horaEntrada);
    const montoActual = calcularMontoActual(espacio.horaEntrada, data.tarifa);
    const placa = obtenerPlaca(espacio.uid, espacio.placa);

    return `
      <div class="parking-slot ${estaLibre ? "free" : "busy"}">
        <div class="slot-header">
          <span class="slot-title">
            Espacio ${String(espacio.id).padStart(2, "0")}
          </span>

          <span class="slot-status">
            ${estaLibre ? "LIBRE" : "OCUPADO"}
          </span>
        </div>

        <div class="car-area">
          <i class="fa-solid ${estaLibre ? "fa-square-parking" : "fa-car-side"} car-icon"></i>
        </div>

        ${
          estaLibre
            ? `
              <div class="slot-detail text-center">
                <strong>Disponible</strong><br>
                Listo para asignación automática
              </div>
            `
            : `
              <div class="slot-detail">
                <strong>Placa:</strong> ${placa}<br>
                <strong>UID:</strong> ${espacio.uid || "-"}<br>
                <strong>Entrada:</strong> ${espacio.horaEntradaTexto || "-"}<br>
                <strong>Tiempo:</strong> ${minutosCobro} min
              </div>

              <div class="price-badge">
                ${formatoSoles(montoActual)} / ${minutosCobro} min
              </div>
            `
        }
      </div>
    `;
  }).join("");

  contenedores.forEach((contenedor) => {
    contenedor.innerHTML = html;
  });
}

/* ===============================
   ÚLTIMOS MOVIMIENTOS EN VIVO
================================ */

function renderizarMovimientosEnVivo(movimientos) {
  const contenedor = document.getElementById("movimientos");

  if (!contenedor) return;

  if (!movimientos || movimientos.length === 0) {
    contenedor.innerHTML = `
      <div class="empty-message">
        <i class="fa-regular fa-clock"></i><br>
        Aún no hay movimientos en vivo.
      </div>
    `;
    return;
  }

  contenedor.innerHTML = movimientos.map((mov) => {
    const tipo = obtenerTipoMovimiento(mov.tipo);
    const icono = obtenerIconoMovimiento(tipo);
    const placa = obtenerPlaca(mov.uid, mov.placa);

    return `
      <div class="movement-item">
        <div class="movement-top">
          <div class="movement-icon ${tipo}">
            <i class="fa-solid ${icono}"></i>
          </div>

          <div>
            <strong>${mov.texto || obtenerTextoMovimiento(tipo)}</strong><br>
            <small>
              Placa: ${placa} | Hora: ${mov.hora || "-"}
            </small>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

/* ===============================
   TABLA MOVIMIENTOS SUPABASE
================================ */

async function cargarMovimientosSupabase() {
  const tabla = document.getElementById("tablaMovimientos");

  if (!tabla) return;

  try {
    const respuesta = await fetch("/api/historial");

    if (!respuesta.ok) {
      throw new Error("No se pudo consultar /api/historial");
    }

    const movimientos = await respuesta.json();

    renderizarTablaMovimientosSupabase(movimientos);
  } catch (error) {
    console.error("Error cargando movimientos desde Supabase:", error);

    tabla.innerHTML = `
      <tr>
        <td colspan="9">
          Error cargando movimientos desde Supabase.
        </td>
      </tr>
    `;
  }
}

function renderizarTablaMovimientosSupabase(movimientos) {
  const tabla = document.getElementById("tablaMovimientos");

  if (!tabla) return;

  if (!Array.isArray(movimientos) || movimientos.length === 0) {
    tabla.innerHTML = `
      <tr>
        <td colspan="9">Aún no hay movimientos guardados en Supabase.</td>
      </tr>
    `;
    return;
  }

  tabla.innerHTML = movimientos.map((mov) => {
    const tipo = obtenerTipoMovimiento(mov.tipo);
    const placa = obtenerPlaca(mov.uid, mov.placa);
    const espacio = mov.espacio ? `Espacio ${mov.espacio}` : "-";
    const minutos = Number(mov.minutos || 0);
    const monto = formatoSoles(mov.monto || 0);

    return `
      <tr>
        <td>${formatearFecha(mov.creado_en)}</td>

        <td>
          <span class="badge-mov ${tipo}">
            ${tipo.toUpperCase()}
          </span>
        </td>

        <td>${placa}</td>
        <td>${mov.uid || "-"}</td>
        <td>${espacio}</td>
        <td>${formatearHora(mov.hora_entrada)}</td>
        <td>${formatearHora(mov.hora_salida)}</td>
        <td>${minutos}</td>
        <td><strong>${monto}</strong></td>
      </tr>
    `;
  }).join("");
}

/* ===============================
   TIPOS DE MOVIMIENTO
================================ */

function obtenerTipoMovimiento(tipo) {
  if (tipo === "entrada") return "entrada";
  if (tipo === "salida") return "salida";
  if (tipo === "denegado") return "denegado";

  return "entrada";
}

function obtenerIconoMovimiento(tipo) {
  if (tipo === "entrada") return "fa-right-to-bracket";
  if (tipo === "salida") return "fa-money-bill-wave";
  if (tipo === "denegado") return "fa-triangle-exclamation";

  return "fa-circle-info";
}

function obtenerTextoMovimiento(tipo) {
  if (tipo === "entrada") return "Vehículo ingresó al estacionamiento";
  if (tipo === "salida") return "Vehículo salió y realizó el pago";
  if (tipo === "denegado") return "Acceso denegado";

  return "Movimiento registrado";
}

/* ===============================
   REPORTES SUPABASE
================================ */

async function cargarReportesSupabase() {
  try {
    const respuesta = await fetch("/api/reportes");

    if (!respuesta.ok) {
      throw new Error("No se pudo consultar /api/reportes");
    }

    const reportes = await respuesta.json();

    renderizarReportesSupabase(reportes);
  } catch (error) {
    console.error("Error cargando reportes desde Supabase:", error);
  }
}

function renderizarReportesSupabase(reportes) {
  const ingresosDia = Number(reportes.ingresosDia || 0);
  const ingresosSemana = Number(reportes.ingresosSemana || 0);
  const ingresosMes = Number(reportes.ingresosMes || 0);
  const tarifa = Number(reportes.tarifa || 0);

  const reporteDia = document.getElementById("reporteDia");
  const reporteSemana = document.getElementById("reporteSemana");
  const reporteMes = document.getElementById("reporteMes");
  const tarifaActual = document.getElementById("tarifaActual");

  if (reporteDia) {
    reporteDia.textContent = formatoSoles(ingresosDia);
  }

  if (reporteSemana) {
    reporteSemana.textContent = formatoSoles(ingresosSemana);
  }

  if (reporteMes) {
    reporteMes.textContent = formatoSoles(ingresosMes);
  }

  if (tarifaActual) {
    tarifaActual.textContent = `${formatoSoles(tarifa)} / min`;
  }

  renderizarDetalleSemanal(reportes.ingresosPorDia || []);
}

function renderizarDetalleSemanal(datos) {
  const contenedor = document.getElementById("detalleSemanal");

  if (!contenedor) return;

  if (!datos || datos.length === 0) {
    contenedor.innerHTML = `
      <div class="empty-message">
        Aún no hay datos suficientes para generar el reporte semanal.
      </div>
    `;
    return;
  }

  const maximo = Math.max(...datos.map((item) => Number(item.total || 0)), 1);

  contenedor.innerHTML = datos.map((item) => {
    const total = Number(item.total || 0);
    const porcentaje = Math.round((total / maximo) * 100);

    return `
      <div class="weekly-row">
        <div class="weekly-day">${item.dia}</div>

        <div class="weekly-bar">
          <div class="weekly-fill" style="width: ${porcentaje}%"></div>
        </div>

        <div class="weekly-value">
          ${formatoSoles(total)}
        </div>
      </div>
    `;
  }).join("");
}

/* ===============================
   SOCKET
================================ */

socket.on("estado", (data) => {
  renderizarEstado(data);

  cargarMovimientosSupabase();
  cargarReportesSupabase();
});

/* ===============================
   BOTONES
================================ */

const btnReset = document.getElementById("btnReset");

if (btnReset) {
  btnReset.addEventListener("click", async () => {
    const confirmar = confirm("¿Seguro que deseas reiniciar el estado del estacionamiento?");

    if (!confirmar) return;

    try {
      await fetch("/api/reset", {
        method: "POST"
      });

      cargarMovimientosSupabase();
      cargarReportesSupabase();
    } catch (error) {
      console.error("Error al reiniciar el sistema:", error);
      alert("No se pudo reiniciar el sistema.");
    }
  });
}

const btnActualizarMovimientos = document.getElementById("btnActualizarMovimientos");

if (btnActualizarMovimientos) {
  btnActualizarMovimientos.addEventListener("click", () => {
    cargarMovimientosSupabase();
  });
}

/* ===============================
   ACTUALIZACIÓN DEL TIEMPO EN TARJETAS
================================ */

setInterval(() => {
  if (ultimoEstado) {
    renderizarEspacios(ultimoEstado);
  }
}, 1000);

/* ===============================
   CARGA INICIAL
================================ */

cargarMovimientosSupabase();
cargarReportesSupabase();