<div align="center">

<img src="assets/brand/repid-mark.svg" width="112" alt="Logo de RePID Identity" />

# RePID Identity

**Descubre qué hace cada proceso. Libera tu equipo desde la raíz.**

App de escritorio gratuita y de código abierto para **Windows, macOS y Linux** que explica en lenguaje humano qué está haciendo cada proceso y servicio de tu equipo, y finaliza los más pesados *junto con todo lo que crearon* para recuperar CPU, RAM y GPU de forma segura.

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-6366f1.svg)](LICENSE)
[![Última versión](https://img.shields.io/github/v/release/rellytechgame/repid-identity?color=22d3ee&label=versi%C3%B3n)](https://github.com/rellytechgame/repid-identity/releases/latest)
[![Descargas](https://img.shields.io/github/downloads/rellytechgame/repid-identity/total?color=8b5cf6&label=descargas)](https://github.com/rellytechgame/repid-identity/releases)
[![CI](https://github.com/rellytechgame/repid-identity/actions/workflows/ci.yml/badge.svg)](https://github.com/rellytechgame/repid-identity/actions/workflows/ci.yml)
[![Estrellas](https://img.shields.io/github/stars/rellytechgame/repid-identity?style=flat&color=eab308&label=estrellas)](https://github.com/rellytechgame/repid-identity/stargazers)
[![PRs bienvenidos](https://img.shields.io/badge/PRs-bienvenidos-10b981.svg)](CONTRIBUTING.md)

[**Descargar**](https://github.com/rellytechgame/repid-identity/releases/latest) ·
[**Demo web**](https://repid-identity-demo.vercel.app) ·
[**Sitio web**](https://repid-identity.vercel.app) ·
[**Reportar un error**](https://github.com/rellytechgame/repid-identity/issues/new/choose) ·
[**English**](README.md)

<br />

<img src="assets/screenshots/dashboard.png" alt="Resumen de RePID Identity: medidores de CPU, memoria y GPU, sugerencia de Liberación inteligente y mayores consumidores" width="900" />

</div>

---

> ⭐ **Si RePID te ahorra tiempo, dale una estrella al repositorio.** Las estrellas son la forma en que otras personas descubren el proyecto: toma un segundo y ayuda muchísimo.

## ¿Por qué RePID Identity?

El Administrador de tareas, el Monitor de actividad o `top` te dicen *que* `node.exe`, `svchost.exe` o `Google Chrome Helper (Renderer)` está consumiendo recursos. No te dicen **qué es, por qué se está ejecutando ni cómo eliminarlo correctamente**:

- Finalizar un proceso de Chrome deja otros 30 en ejecución.
- Finalizar el proceso de un servicio solo hace que el administrador de servicios lo reinicie.
- Finalizar el proceso del sistema equivocado cierra tu sesión o cuelga el equipo.

RePID (*Re*-identificar el *PID*) resuelve eso: **identifica** cada proceso, lo **agrupa** con la aplicación a la que pertenece, lo **explica** en tu idioma y **finaliza todo el árbol desde la raíz**, haciendo imposible tocar algo que rompa tu sistema.

## Funciones

| | |
|---|---|
| 🧠 **Motor de identidad** | Combina un catálogo de más de 70 apps y componentes del sistema, el script que ejecuta un intérprete (`node vite`, `python train_model.py`), los servicios alojados, la ruta de instalación y los metadatos del editor del ejecutable. |
| 🌳 **Finalización desde la raíz** | Finaliza la app y cada hijo que creó, empezando por el supervisor para que no pueda relanzarlos. Primero `SIGTERM` ordenado; `SIGKILL` solo para los que sobreviven (POSIX). |
| ✨ **Liberación inteligente** | Una puntuación de impacto 0–100 combina CPU, RAM y GPU y sugiere qué cerrar, sin incluir nunca procesos del sistema, servicios ni lo que hayas protegido. |
| 📈 **CPU · RAM · GPU en vivo** | Medidores con historial, uso por aplicación y GPU por proceso (contadores del motor de GPU en Windows, `nvidia-smi` en el resto). |
| ⚙️ **Consciente de servicios** | Detecta servicios de Windows, unidades systemd y agentes launchd, y los **detiene** mediante su administrador. |
| 🛡️ **Red de seguridad** | Protección en tres niveles (Protegido / Precaución / Seguro) aplicada dentro del motor y verificada otra vez justo antes de cada acción. |
| 🚀 **Modo rendimiento** | Perfiles de un clic (Juego, Concentración, Render/compilar, Personalizado) que hacen que las apps en segundo plano **cedan CPU** a lo que estás usando: prioridad inferior a la normal más **EcoQoS** de Windows 11 (la hoja verde del Administrador de tareas) y, opcionalmente, prioridad superior para una app. No se cierra nada; todo se restaura al detenerlo o al cerrar RePID. |
| ⏻ **Programas de inicio** | Todo lo que se abre al iniciar sesión (claves Run del registro, carpetas Inicio, apps de Microsoft Store, tareas programadas · LaunchAgents e ítems de inicio · autostart XDG) con su nombre real, editor e **impacto medido en vivo**. Se deshabilita de forma reversible con el mecanismo del propio sistema, avisando antes qué pasará, y se restaura todo lo que cambió RePID con un clic. |
| 📦 **Desinstalador inteligente** | Ejecuta el **desinstalador oficial** de cada app y luego encuentra lo que dejó: carpeta de instalación, carpetas en AppData/ProgramData, cachés, claves del registro, entradas de inicio, tareas programadas y accesos directos (macOS: `~/Library` por bundle id · Linux: Flatpak). Los rastros se identifican por **nombre exacto**, nunca carpetas de otras apps; los archivos van a la **Papelera** y las claves del registro se **respaldan** antes. También encuentra **rastros de apps que ya desinstalaste**: carpetas sin dueño, accesos directos, entradas de inicio y registros rotos. |
| 🧹 **Limpieza profunda** | Temporales, temporales del sistema, caché de actualizaciones, papelera, caché DNS, cachés de paquetes y la **caché, historial y cookies de todos los navegadores** (Chrome, Edge, Firefox, Brave, Opera, Opera GX, Vivaldi, Chromium, Safari). Cada elemento explica *exactamente qué pasará* antes de borrarlo; lo irreversible requiere confirmación explícita. Contraseñas, marcadores y documentos nunca se tocan. |
| 🗺️ **Analizador de disco** | Un mapa en el que puedes hacer clic para ver qué llena tu disco, los archivos más grandes (filtro: sin tocar hace un año) y los **duplicados reales**, encontrados por huella SHA-256 del contenido. Siempre conserva una copia, nunca ofrece carpetas del sistema, programas, datos de apps ni de herramientas, y todo va a la Papelera. |
| ⏱️ **Modo automático** | El modo rendimiento se activa solo al abrir un juego (bibliotecas de Steam, Epic, GOG, Xbox, EA, Ubisoft, Riot, Battle.net) o una app que elijas, y se apaga al cerrarlo; limpieza programada solo de lo seguro; avisos de memoria descontrolada y disco lleno; icono en la bandeja e inicio con el sistema opcionales. |
| ⬇️ **Actualizaciones de apps** | Lista los programas desactualizados y los actualiza con el gestor oficial del sistema (winget · Homebrew · Flatpak). Los saltos de versión mayor se marcan y nunca vienen seleccionados. |
| 🩺 **Salud del equipo** | Estado de los discos, desgaste del SSD, temperaturas y errores, capacidad de la batería frente a nueva, espacio libre y tiempo encendido, explicado en simple; punto de restauración de Windows con un clic. |
| 🌐 **Red por app** | Qué apps están conectadas ahora, cuántas conexiones y con qué servidores; bloquea o desbloquea internet de una app con una regla del Firewall de Windows. |
| 🧩 **Servicios de Windows** | Lista curada de servicios que arrancan con Windows (actualizadores, telemetría, acceso remoto, bases de datos…) que pueden iniciarse solo cuando hacen falta. Pasa a *Manual* —nunca deshabilitado— con el efecto explicado, verificado y reversible. Drivers, audio, red y seguridad nunca se muestran. |
| 🔑 **Privilegios completos** | En Windows se ejecuta como administrador (UAC al iniciar) para finalizar cualquier proceso, detener servicios y limpiar carpetas del sistema. En macOS/Linux pide tu contraseña solo para las acciones que lo necesitan. Los procesos críticos siguen bloqueados. |
| 🌍 **Multiidioma** | Español e inglés incluidos. Agregar un idioma es añadir **un archivo JSON**. |
| 🔒 **100 % local** | Sin cuentas, sin telemetría, sin servidores. |

## Capturas

| Entiende qué hace un proceso | Liberación inteligente |
|---|---|
| <img src="assets/screenshots/identify.png" alt="Lista de procesos con el panel de detalle de un proceso de Python" /> | <img src="assets/screenshots/smart.png" alt="Diálogo de Liberación inteligente" /> |
| **Desinstalador inteligente** | **Modo rendimiento** |
| <img src="assets/screenshots/uninstall.png" alt="Asistente de desinstalación con los rastros encontrados" /> | <img src="assets/screenshots/boost.png" alt="Modo rendimiento activo con el perfil Juego" /> |
| **Programas de inicio** | **Mapa del disco** |
| <img src="assets/screenshots/startup.png" alt="Programas de inicio con impacto medido y qué pasará al deshabilitarlos" /> | <img src="assets/screenshots/disk.png" alt="Analizador de disco con un mapa de la carpeta personal" /> |
| **Modo automático** | **Actualizaciones de apps** |
| <img src="assets/screenshots/automation.png" alt="Modo automático: juegos, limpieza programada, avisos y segundo plano" /> | <img src="assets/screenshots/updates.png" alt="Lista de apps con versión nueva" /> |
| **Salud del equipo** | **Red por app** |
| <img src="assets/screenshots/health.png" alt="Salud: discos, batería, temperaturas y espacio" /> | <img src="assets/screenshots/network.png" alt="Apps con conexiones de red y botón para bloquear internet" /> |
| **Servicios de Windows** | |
| <img src="assets/screenshots/services.png" alt="Servicios de Windows con sugerencias para pasar a manual" /> | |

## Descarga e instalación

Descarga el instalador para tu sistema desde la [**última versión**](https://github.com/rellytechgame/repid-identity/releases/latest):

| Sistema | Paquete | Notas |
|---|---|---|
| **Windows 10/11** | Instalador `.exe` o portable | x64 y ARM64. Solicita permisos de administrador al iniciar (UAC) para finalizar cualquier proceso, detener servicios y limpiar carpetas del sistema. |
| **macOS 12+** | `.dmg` | Apple Silicon e Intel. |
| **Linux** | `.AppImage`, `.deb`, `.rpm` | Los servicios del sistema se detienen con polkit (`pkexec`) cuando hace falta. |

## Modo rendimiento

No finaliza ningún proceso: solo cambia la **prioridad**, y solo de apps clasificadas como seguras.

| Perfil | Ceden CPU (preseleccionadas) | Nunca preseleccionadas |
|---|---|---|
| 🎮 Juego | Navegadores, sincronización, actualizadores, ofimática, IDEs, procesos auxiliares | Chat de voz, overlays, launchers, multimedia, scripts y contenedores en ejecución, apps desconocidas (podría ser el juego) |
| 🎯 Concentración | Launchers de juegos, actualizadores, procesos auxiliares | Tus apps de trabajo |
| 🛠️ Render / compilar | Navegadores, chat, launchers, multimedia, sincronización, actualizadores, ofimática | Tu editor, renderizador o compilación |
| ⚙️ Personalizado | Nada: eliges tú | — |

- **Eficiencia**: prioridad inferior a la normal (`nice 10` en macOS/Linux) más **EcoQoS** en Windows 11. Nunca anula una elección manual más fuerte (por ejemplo «Baja»).
- **App prioritaria**: solo «por encima de lo normal». Nunca «Alta» ni «Tiempo real», que pueden congelar teclado y audio. Solo Windows (en otros sistemas subir prioridad requiere root).
- Los procesos nuevos que abra la app (pestañas nuevas) se ajustan automáticamente.
- Cada cambio se registra con su valor original y se restaura con **Restaurar todo**, al cambiar la selección y al cerrar RePID.
- Componentes del sistema, servicios, seguridad y todo lo marcado con *precaución* conservan su prioridad, y eso lo hace cumplir el proceso principal, no solo la interfaz.

## Programas de inicio

| Origen | Cómo lo deshabilita RePID |
|---|---|
| Registro Run (usuario / equipo / 32 bits) | Marca `StartupApproved`, exactamente lo que escribe el Administrador de tareas. El valor Run no se toca. |
| Accesos directos de la carpeta Inicio | Marca `StartupApproved\StartupFolder`; el acceso directo se conserva. |
| Apps de Microsoft Store | `State` = deshabilitado por el usuario, igual que *Configuración › Aplicaciones › Inicio*. |
| Tareas programadas al iniciar sesión (no Microsoft) | `schtasks /Change /DISABLE`. |
| LaunchAgents de macOS | `launchctl disable gui/<uid>/<label>`; el plist no se toca. |
| Ítems de inicio de macOS | Se quitan y RePID guarda su ruta para volver a agregarlos. |
| Autostart XDG (Linux) | `Hidden=true` en tu copia de usuario; nunca se modifica `/etc`. |

- **Bloqueados**: componentes de Windows, entradas impuestas por directiva y piezas del escritorio en macOS/Linux.
- **Precaución** (aviso + confirmación): seguridad, utilidades de hardware (audio, touchpad, teclas, RGB, GPU) y sincronización en la nube.
- **Sugeridos**: actualizadores, navegadores precargados, chat, multimedia y launchers de juegos.
- El impacto se **mide en el momento** con lo que consume el programa abierto.
- Tras cada cambio RePID vuelve a leer el estado y avisa si no se aplicó. Todo lo que deshabilitó queda en un historial con **Restaurar todo**.

## Desinstalador inteligente

1. **Primero el desinstalador oficial** de la app (o `msiexec /x` para MSI, `Remove-AppxPackage` para Microsoft Store, Papelera para una `.app` de macOS, `flatpak uninstall` en Linux). RePID espera a que termine, incluso si se relanza desde `%TEMP%`, y puede cerrar la app antes.
2. **Verificado:** si la app sigue instalada (cancelaste en su ventana), RePID se detiene y no busca rastros de una app instalada.
3. **Rastros con evidencia:** carpeta de instalación declarada; carpetas con el nombre **exacto** de la app (o `Fabricante\App`) en AppData, LocalLow, ProgramData, Program Files y el menú Inicio; claves `Software\App` o `Software\Fabricante\App`; entradas de inicio, tareas y accesos directos que abren archivos de la app.

**Rastros de apps ya desinstaladas:** RePID revisa cada carpeta de AppData, LocalLow, ProgramData y Program Files contra todas las pruebas de uso (apps instaladas, procesos, **servicios y drivers**, entradas de inicio vigentes y destinos de accesos directos) y solo ofrece lo que nadie reclama **y** lleva más de 60 días sin cambios. Vienen marcados los accesos directos, entradas de inicio, tareas y registros rotos y las carpetas sin programas inactivas desde hace meses; lo que contiene programas o partidas guardadas queda para que lo revises.

Reglas aprendidas en una simulación sobre 69 apps reales: los nombres de menos de 6 letras solo valen dentro de la carpeta del fabricante; la versión solo se quita del **final** del nombre; las carpetas compartidas con otra app no se ofrecen; los nombres de otras apps instaladas se excluyen; .NET, Visual C++, WebView2, componentes del sistema y RePID están bloqueados; drivers, seguridad y runtimes piden confirmación. Los archivos van a la Papelera y las claves se respaldan en `.reg` (doble clic para restaurar).

## Limpieza profunda

<img src="assets/screenshots/cleanup.png" alt="Módulo de limpieza" width="800" />

| Elemento | Riesgo | Qué pasará |
|---|---|---|
| Temporales y cachés de usuario | 🟢 Seguro | Se recrean solos; los archivos en uso se omiten. |
| Temporales del sistema | 🟠 Precaución | Requiere administrador. No afecta documentos. |
| Caché de actualizaciones | 🟠 Precaución | No desinstala actualizaciones; las pendientes se vuelven a descargar. |
| Papelera | 🔴 Sensible | Borrado **definitivo**. Desactivado por defecto. |
| Caché DNS | 🟢 Seguro | Sin efectos negativos. |
| Cachés de paquetes | 🟠 Precaución | La próxima instalación vuelve a descargar. |
| Caché del navegador | 🟢 Seguro | No cierra sesiones ni borra contraseñas. |
| Historial del navegador | 🔴 Sensible | Irreversible. **Marcadores y contraseñas se conservan.** |
| Cookies del navegador | 🔴 Sensible | Cierra sesión en todos los sitios web. |
| Caché de aplicaciones | 🟢 Seguro | Caché de apps Electron/Chromium (Discord, Slack, VS Code, Postman…). Sesiones y mensajes se conservan. |
| Volcados de memoria | 🟢 Seguro | `MEMORY.DMP` y `Minidump`: solo sirven para diagnosticar fallos pasados. |
| Windows anterior y restos de actualizaciones | 🟠 Precaución | `Windows.old` y archivos de instalación, con la herramienta oficial de Windows. Ya no podrás volver a la versión anterior. |

Si un navegador está abierto, RePID te lo indica y te ofrece cerrarlo (advirtiendo del trabajo no guardado) u omitirlo.

## Analizador de disco

1. **Mapa.** Elige tu carpeta personal o una unidad. RePID la recorre en paralelo (unos 1,5 millones de archivos en 80 segundos en el SSD de un portátil), nunca sigue enlaces simbólicos ni uniones, y dibuja un mapa en el que puedes entrar con un clic.
2. **Archivos grandes.** De 100 MB o más, con filtro para los que no se tocan hace más de un año.
3. **Duplicados.** Mismo tamaño → mismos primeros y últimos 64 KB → misma huella **SHA-256** completa. Que se llamen igual no basta.

Nunca se ofrece borrar (en el mapa aparecen rayados): Windows y `Program Files` de cualquier unidad, `ProgramData`, AppData, la Papelera y las **carpetas de herramientas**: cualquier carpeta que empiece por punto (`.git`, `.gradle`, `.android`, `.nuget`…), `node_modules`, `venv`, `vendor`, la caché de módulos de Go y las salidas de compilación. Las librerías (`.dll`, `.jar`, `.so`…) nunca cuentan como duplicados, y los programas solo si están en Descargas. De cada duplicado siempre queda una copia (el motor rechaza una petición que borraría todas), se rechazan los archivos que cambiaron desde el análisis, y todo va a la Papelera. Estas reglas salieron de una prueba real, en la que un análisis ingenuo marcaba como "duplicados" cachés de Gradle e imágenes del emulador de Android.

## Modo automático

| | Qué hace | Seguridad |
|---|---|---|
| **Rendimiento para juegos** | Al abrir un juego de una biblioteca de tienda o una app de tu lista, aplica el perfil Juego (prioridad para él, apps en segundo plano en modo eficiencia). Se apaga al cerrarlo. | Nunca reemplaza un modo rendimiento que activaste tú; si lo apagas a mano, no vuelve hasta que cierres esa app. Los lanzadores, el antitrampas y los reportadores de errores no cuentan como juegos. |
| **Limpieza programada** | Diaria o semanal. | Solo lo que RePID marca como seguro y preseleccionado; nunca datos sensibles, nunca lo que use una app abierta, nunca lo que requiere administrador sin serlo, nunca durante un juego. La primera vez se ejecuta un intervalo completo después de activarla. |
| **Avisos** | Una app cuya memoria no deja de crecer (+1 GB y +50 % en 30 min, por encima de 1,5 GB, sin bajar) o un disco por encima de tu umbral. | Notificaciones del sistema; al hacer clic se abre la sección correspondiente. |
| **Segundo plano** | Seguir en la bandeja al cerrar la ventana; iniciar minimizado con la sesión (Windows/macOS). | Desactivado por defecto. |

## Actualizaciones, salud, red y servicios

- **Actualizaciones:** RePID usa el gestor de paquetes del sistema (`winget upgrade` en Windows, `brew outdated` en macOS, `flatpak` en Linux) e instala las que elijas con ids exactos pasados como argumentos separados. La salida de winget se lee por posición de columnas, así funciona en cualquier idioma de Windows. Los saltos de versión mayor (MariaDB 11 → 13, WinRAR 6 → 7) pueden cambiar cómo funciona una app o sus datos, por eso se marcan y no vienen seleccionados.
- **Salud:** estado de los discos (con desgaste, temperatura, errores y horas de uso cuando RePID es administrador), capacidad real de la batería con `powercfg /batteryreport` (sin administrador), temperaturas si el hardware las expone, espacio por unidad y días sin reiniciar. Los problemas se ordenan del más grave al más leve.
- **Puntos de restauración:** en Windows (administrador y Protección del sistema activada) RePID crea uno a mano y, salvo que lo desactives en Ajustes, antes de cambiar servicios, desinstalar una app o borrar `Windows.old`. Windows permite uno cada 24 horas; RePID te avisa cuando uno reciente ya te cubre.
- **Red:** conexiones abiertas de cada app (sin contar el tráfico local), con qué servidores habla y en qué puertos escucha, cada 4 segundos. En Windows, *Bloquear internet* crea una regla de salida del Firewall (grupo "RePID Identity") para ese programa; las reglas se ven aunque el programa esté cerrado y se quitan con un clic. Los componentes del sistema no se pueden bloquear.
- **Servicios (Windows):** solo servicios con inicio automático de una lista curada: telemetría de Microsoft, Mapas, seguimiento de vínculos, fax y modo demostración (sugeridos); Búsqueda, SysMain y Cola de impresión (precaución); actualizadores y analíticas de otros fabricantes (sugeridos); acceso remoto, bases de datos y licencias (precaución, nunca preseleccionados). Drivers, audio, touchpad, GPU, red, seguridad y cualquier otro componente interno de Windows nunca se muestran. RePID solo cambia *Automático → Manual* (Windows lo sigue iniciando cuando hace falta), guarda el modo original (incluido *retrasado*), verifica el cambio y lo restaura exactamente.
- **Privacidad:** RePID no hace peticiones de red propias salvo el contador de estrellas de GitHub. La sección *Actualizaciones* ejecuta el gestor de paquetes del sistema, que consulta sus repositorios, solo cuando abres esa sección.

## Compatibilidad

| Plataforma | Estado | Motivo |
|---|---|---|
| Windows · macOS · Linux | ✅ Completa | Procesos, servicios, metadatos y GPU por proceso donde el controlador lo permite. |
| Web | 🟡 Demo | Los navegadores no pueden ver los procesos del sistema. La [demo web](https://repid-identity-demo.vercel.app) usa la misma interfaz y lógica con un equipo simulado. |
| Android / iOS | ❌ No es posible | Los sistemas móviles aíslan cada app y prohíben ver o finalizar procesos de otras. Una versión móvil no podría hacer su trabajo, por eso no la publicamos. |

## Seguridad

| Nivel | Ejemplos | Comportamiento |
|---|---|---|
| 🔴 **Protegido** | `System`, `csrss`, `lsass`, `svchost`, `kernel_task`, `launchd`, `systemd`, RePID, lo que agregues | Nunca se finaliza; la interfaz lo deshabilita **y** el motor lo rechaza. |
| 🟠 **Precaución** | `explorer`, `vmmem`, `Finder`, `pipewire` | Requiere una confirmación explícita. |
| 🟢 **Seguro** | Apps de usuario | El diálogo muestra el árbol completo y la memoria que se liberará. |

Más detalles en [SECURITY.md](SECURITY.md) y [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Desarrollo

```bash
git clone https://github.com/rellytechgame/repid-identity.git
cd repid-identity
npm ci
npm run dev          # App de escritorio con recarga en caliente
npm run dev:web      # Interfaz en el navegador con datos simulados
npm test             # Pruebas unitarias
npm run dist         # Instaladores en release/
```

Requisitos: Node.js ≥ 20. La tabla completa de scripts está en el [README en inglés](README.md#development).

## Idiomas

¿Quieres RePID en tu idioma? Sigue la [guía de traducción](docs/ADDING_A_LANGUAGE.md): copia `en.json`, tradúcelo y abre un pull request. La app lo detecta automáticamente.

## Contribuir

Toda contribución es bienvenida: código, un proceso que falta en el catálogo, una traducción o un reporte de error. Empieza por [CONTRIBUTING.md](CONTRIBUTING.md).

## Apoya el proyecto

RePID Identity es gratis, sin anuncios, sin venta de datos y **nunca** tendrá funciones de pago. Las donaciones financian la firma de código (certificado de Windows y cuenta de Apple Developer), el mantenimiento, el catálogo y las traducciones.

| Nivel | Monto | Recibes |
|---|---|---|
| ☕ Café | 3 USD | Agradecimiento público en las notas de la próxima versión |
| 🚀 Impulsor | 10 USD | Tu nombre en el muro de colaboradores (app, sitio web y [SUPPORTERS.md](SUPPORTERS.md)) |
| 💎 Patrocinador | 25 USD | Nombre **con enlace** · voto en la hoja de ruta · prioridad en tus reportes |
| 🏢 Empresa | 100 USD | Logo en este README, el sitio web y la pantalla *Acerca de* durante 12 meses · canal de contacto directo |

<div align="center">

[![Donar con PayPal](https://img.shields.io/badge/Donar-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/iandasystems)

</div>

Escribe tu nombre o usuario de GitHub en la nota de PayPal para acreditarte (se aplica manualmente en 7 días).

## Licencia y créditos

Publicado bajo la [Licencia MIT](LICENSE) © 2026 Voxel Enterprise.

<div align="center">
<br />
<sub>Diseñado y desarrollado por</sub><br />
<a href="https://github.com/rellytechgame">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/voxel-logo-light.png" />
    <img src="assets/brand/voxel-logo-dark.png" alt="Voxel Enterprise" width="200" />
  </picture>
</a>
</div>
