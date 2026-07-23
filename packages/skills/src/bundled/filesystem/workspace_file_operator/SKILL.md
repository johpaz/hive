---
name: workspace_file_operator
description: "Safely create, read, edit, organize, and verify files or folders inside an authorized workspace"
version: 1.0.0
author: Hive Team
icon: "📁"
category: filesystem
permissions: [filesystem_read, filesystem_write]
dependencies: []
tools: [fs_read, fs_write, fs_edit, fs_delete, fs_list, fs_glob, fs_exists]
triggers: [crear carpeta, organizar archivos, editar archivo, create folder, manage files]
preferred_agents: [workspace_file_operator]
---

# Operación segura del workspace

1. Resuelve todas las rutas contra el workspace asignado.
2. Comprueba el estado inicial con `fs_exists`, `fs_list` o `fs_read`.
3. Aplica la operación mínima solicitada.
4. Verifica el estado final mediante readback.

Nunca accedas fuera del workspace ni declares éxito basándote solo en el resultado de una escritura.
