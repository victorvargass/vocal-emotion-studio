# Vocal Emotion Studio

Una partitura emocional y teleprompter para preparar canciones antes de cantarlas en vivo.

## Qué permite hacer

- Escribir o pegar una letra, usando cada salto de línea como paso del teleprompter.
- Seleccionar una palabra o frase y añadir emoción, dinámica, recurso vocal, gesto y una nota libre.
- Ver las indicaciones en pequeño justo debajo de la letra, sin abrir paneles para recordarlas.
- Ensayar con cuenta de entrada y avance automático según BPM y pulsos por línea.
- Cargar una pista de karaoke local y marcar el inicio de cada línea mientras suena.
- Guardar automáticamente varias canciones en el navegador e importarlas o exportarlas en JSON.
- Usar el modo ensayo en pantalla completa y controlarlo con espacio y las flechas arriba/abajo.

## Uso rápido

1. En **Escribir**, pega la letra y separa las frases como quieras verlas al cantar.
2. En **Preparar**, selecciona una frase y añade una indicación. En celular pulsa **Seleccionar frase** y toca la primera y la última palabra; en computador puedes arrastrar o usar Mayús + clic.
3. Ajusta el BPM y la duración estimada de cada línea.
4. Opcionalmente, carga una pista. Reprodúcela y pulsa **Marcar aquí** cuando empiece cada línea.
5. Entra a **Ensayar**. Sin marcas de audio la letra sigue el BPM; con marcas, sigue la pista.

La pista de audio se usa solo en la sesión actual y no se guarda ni se sube a ningún servidor. Las marcas de tiempo sí se conservan, por lo que al volver solo hay que cargar la misma pista.

## Ejecutar localmente

Es una aplicación estática: puedes abrir `index.html` directamente o servir la carpeta con cualquier servidor HTTP.

```bash
python -m http.server 4173
```

Luego abre `http://127.0.0.1:4173`.

No requiere compilación, dependencias ni backend y funciona en GitHub Pages.
