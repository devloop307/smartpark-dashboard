const titulosVistas = {
  dashboard: {
    titulo: "Panel de Control",
    descripcion: "Monitoreo de estacionamiento inteligente con RFID, AWS IoT y Supabase"
  },
  espacios: {
    titulo: "Gestión de Espacios",
    descripcion: "Vista completa de ocupación, vehículos asignados y tiempo activo"
  },
  movimientos: {
    titulo: "Historial de Movimientos",
    descripcion: "Registros guardados en Supabase PostgreSQL"
  },
  reportes: {
    titulo: "Reportes de Ingresos",
    descripcion: "Resumen diario, semanal y mensual desde Supabase"
  },
  camara: {
    titulo: "Cámara del Estacionamiento",
    descripcion: "Vista en tiempo real desde la cámara móvil conectada por Cloudflare Tunnel"
  }
};

function inicializarVistas() {
  const botonesMenu = document.querySelectorAll("[data-view]");

  botonesMenu.forEach((boton) => {
    if (boton.dataset.listener === "true") return;

    boton.addEventListener("click", (event) => {
      event.preventDefault();

      const vista = boton.dataset.view;
      cambiarVista(vista);
    });

    boton.dataset.listener = "true";
  });

  cambiarVista("dashboard");
}

function cambiarVista(vista) {
  const vistaSeleccionada = document.getElementById(`vista-${vista}`);

  if (!vistaSeleccionada) {
    console.warn(`La vista "${vista}" no existe en el HTML.`);
    return;
  }

  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.remove("active");
  });

  document.querySelectorAll(".menu-item").forEach((item) => {
    item.classList.remove("active");
  });

  vistaSeleccionada.classList.add("active");

  const menuActivo = document.querySelector(`[data-view="${vista}"]`);

  if (menuActivo) {
    menuActivo.classList.add("active");
  }

  actualizarTituloVista(vista);

  if (vista === "movimientos") {
    if (typeof cargarMovimientosSupabase === "function") {
      cargarMovimientosSupabase();
    }
  }

  if (vista === "reportes") {
    if (typeof cargarReportesSupabase === "function") {
      cargarReportesSupabase();
    }
  }

  if (vista === "camara") {
    refrescarCamara();
  }
}

function actualizarTituloVista(vista) {
  const infoVista = titulosVistas[vista];

  if (!infoVista) return;

  const titulo = document.querySelector(".topbar h1");
  const descripcion = document.querySelector(".topbar p");

  if (titulo) {
    titulo.textContent = infoVista.titulo;
  }

  if (descripcion) {
    descripcion.textContent = infoVista.descripcion;
  }
}

function refrescarCamara() {
  const camara = document.getElementById("camaraEstacionamiento");

  if (!camara) return;

  camara.src = `/api/camara?t=${Date.now()}`;
}

document.addEventListener("DOMContentLoaded", () => {
  inicializarVistas();
});