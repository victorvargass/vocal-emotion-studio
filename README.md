# Vocal Emotion Studio

Una partitura emocional y teleprompter para preparar canciones antes de cantarlas en vivo.

## Qué permite hacer

- Escribir o pegar una letra, usando cada salto de línea como paso del teleprompter.
- Seleccionar una palabra o frase y añadir emoción, dinámica, recurso vocal, gesto y una nota libre.
- Ver las indicaciones en pequeño justo debajo de la letra, sin abrir paneles para recordarlas.
- Ensayar con cuenta de entrada y avance automático según BPM y pulsos por línea.
- Escuchar un metrónomo durante la cuenta y la canción, con tempo, compás y volumen ajustables en vivo.
- Cargar una pista de karaoke local y marcar el inicio de cada línea mientras suena.
- Detectar automáticamente un BPM estimado al cargar la pista.
- Sincronizar la letra línea por línea con un reproductor ancho, ajuste fino de 0,1 segundos y edición o borrado de las marcas temporales.
- Completar automáticamente las entradas que faltan interpolando y prolongando el ritmo de las marcas manuales.
- Abrir o cerrar por separado los paneles de pista y letra, con la pista siempre ubicada primero.
- Ver la frase activa y un cursor de avance sobre la letra mientras se reproduce el audio.
- Transponer la pista entre −6 y +6 semitonos sin cambiar el tempo.
- Guardar automáticamente varias canciones en el navegador e importarlas o exportarlas en JSON.
- Usar el modo ensayo en pantalla completa, reiniciarlo desde `0:00` y controlarlo con espacio y las flechas arriba/abajo.

## Uso rápido

1. En **Escribir**, pega la letra y separa las frases como quieras verlas al cantar.
2. En **Preparar**, selecciona una frase y añade una indicación. En celular pulsa **Seleccionar frase** y toca la primera y la última palabra; en computador puedes arrastrar o usar Mayús + clic.
3. Ajusta el BPM y la duración estimada de cada línea.
4. Elige el compás, activa el metrónomo y ajusta su volumen.
5. Opcionalmente, carga una pista. La app estima su BPM y permite subirla o bajarla por semitonos.
6. Pulsa **Sincronizar letra**. Usa la primera marca para fijar el primer pulso fuerte del compás; el metrónomo continuará desde ahí. Las marcas siguientes indican cuándo comienza cada frase y gobiernan el cursor de la letra.
7. Entra a **Ensayar**. Sin marcas de audio la letra sigue el BPM; con marcas, sigue exactamente la pista. El botón del metrónomo permite cambiar la tonalidad y el pulso sin detener la reproducción.

La pista de audio se usa solo en la sesión actual y no se guarda ni se sube a ningún servidor. Las marcas de tiempo sí se conservan, por lo que al volver solo hay que cargar la misma pista.

## Ejecutar localmente

Es una aplicación estática: puedes abrir `index.html` directamente o servir la carpeta con cualquier servidor HTTP.

```bash
python -m http.server 4173
```

Luego abre `http://127.0.0.1:4173`.

No requiere compilación ni backend y funciona en GitHub Pages. El cambio de tonalidad usa Tone.js 15.1.22 cargado desde jsDelivr.
