/**
 * LessonPersistence — Persistencia de lecciones HiveLearn en SQLite
 *
 * Guarda el ciclo completo de vida de una lección:
 * 1. Perfil del alumno → hl_student_profiles
 * 2. Curriculum generado → hl_curricula
 * 3. Sesión de aprendizaje → hl_sessions
 * 4. Métricas de la sesión → hl_session_metrics
 * 5. Efectividad por nodo → hl_node_effectiveness
 */
import type { Database } from 'bun:sqlite'
import { getDb } from '@johpaz/hive-agents-core/storage/sqlite'
import type { StudentProfile, LessonProgram, NodoLesson, GamificacionOutput, EvaluacionOutput } from '../types'

export interface SessionData {
  sessionId: string
  alumnoId: string
  curriculoId: number
  xpTotal: number
  nivelAlcanzado: string
  logrosJson: string
  nodosCompletados: number
  evaluacionPuntaje: number | null
  completada: boolean
}

export interface SessionMetrics {
  sessionId: string
  alumnoId: string
  curriculoId: number
  tema: string
  duracionRealSeg: number
  nodosTotal: number
  nodosCompletados: number
  puntajeEvaluacion: number | null
  intentosPorNodo: string
  nodosDominados: string
  nodosDificiles: string
  logrosDesbloqueados: string
  xpGanado: number
  completada: boolean
}

export interface NodeEffectiveness {
  id: string
  nodoContentHash: string
  agenteTipo: string
  tema: string
  tipoPedagogico: string
  tipoVisual: string
  rangoEdad: string
  intentosPromedio: number
  tasaAbandono: number
  tiempoPromedio: number
  vecesVisto: number
  vecesCompletado: number
}

export class LessonPersistence {
  private db: Database

  constructor() {
    this.db = getDb()
  }

  // ─── Config Check ───────────────────────────────────────────────────

  /** Verifica si los agentes de HiveLearn ya tienen provider/model configurados */
  getHiveLearnProviderModel(): { providerId: string; modelId: string } | null {
    const row = this.db.query(`
      SELECT provider_id, model_id FROM agents WHERE id = ? LIMIT 1
    `).get('hl-profile-agent') as { provider_id: string; model_id: string } | undefined

    if (row?.provider_id && row?.model_id) {
      return { providerId: row.provider_id, modelId: row.model_id }
    }
    return null
  }

  // ─── Student Profiles ───────────────────────────────────────────────

  saveStudentProfile(profile: StudentProfile): void {
    this.db.query(`
      INSERT OR REPLACE INTO hl_student_profiles
        (alumno_id, nombre, edad, rango_edad, tiempo_sesion, nivel_previo, estilo, sesiones_total, xp_acumulado, nivel_actual, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT sesiones_total FROM hl_student_profiles WHERE alumno_id = ?), 0), COALESCE((SELECT xp_acumulado FROM hl_student_profiles WHERE alumno_id = ?), 0), COALESCE((SELECT nivel_actual FROM hl_student_profiles WHERE alumno_id = ?), 'Aprendiz'), CURRENT_TIMESTAMP)
    `).run(
      profile.alumnoId,
      profile.nombre,
      profile.edad,
      profile.rangoEdad,
      profile.tiempoSesion,
      profile.nivelPrevio,
      profile.estilo,
      profile.alumnoId,
      profile.alumnoId,
      profile.alumnoId,
    )
  }

  getStudentProfile(alumnoId: string): StudentProfile | null {
    const row = this.db.query('SELECT * FROM hl_student_profiles WHERE alumno_id = ?').get(alumnoId) as Record<string, any> | undefined
    if (!row) return null
    return {
      alumnoId: row.alumno_id,
      nombre: row.nombre,
      edad: row.edad,
      rangoEdad: row.rango_edad,
      tiempoSesion: row.tiempo_sesion,
      nivelPrevio: row.nivel_previo,
      estilo: row.estilo,
      sesionesTotal: row.sesiones_total,
      xpAcumulado: row.xp_acumulado,
      nivelActual: row.nivel_actual,
    }
  }

  // ─── Curriculum ─────────────────────────────────────────────────────

  saveCurriculum(sessionId: string, meta: string, nodosJson: string, totalNodos: number, rangoEdad: string, topicSlug: string | null): number {
    const result = this.db.query(`
      INSERT OR REPLACE INTO hl_curricula
        (session_id, topic_slug, meta_alumno, nodos_json, total_nodos, rango_edad)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, topicSlug, meta, nodosJson, totalNodos, rangoEdad)

    return Number(result.lastInsertRowid)
  }

  getCurriculumBySessionId(sessionId: string): { id: number; nodos_json: string; topic_slug: string | null } | null {
    return this.db.query(
      'SELECT id, nodos_json, topic_slug FROM hl_curricula WHERE session_id = ?'
    ).get(sessionId) as { id: number; nodos_json: string; topic_slug: string | null } | null
  }

  // ─── Sessions ───────────────────────────────────────────────────────

  createSession(sessionId: string, alumnoId: string, curriculoId: number, rangoEdad: string): void {
    this.db.query(`
      INSERT OR IGNORE INTO hl_sessions
        (session_id, alumno_id, curriculo_id, xp_total, nivel_alcanzado, logros_json, nodos_completados, evaluacion_puntaje, completada)
      VALUES (?, ?, ?, 0, 'Aprendiz', '[]', 0, NULL, 0)
    `).run(sessionId, alumnoId, curriculoId)
  }

  updateSessionProgress(sessionId: string, nodosCompletados: number, xpTotal: number): void {
    this.db.query(`
      UPDATE hl_sessions
      SET nodos_completados = ?, xp_total = ?, updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ?
    `).run(nodosCompletados, xpTotal, sessionId)
  }

  completeSession(sessionId: string, xpTotal: number, nivelAlcanzado: string, logrosJson: string, evaluacionPuntaje: number | null): void {
    this.db.query(`
      UPDATE hl_sessions
      SET xp_total = ?, nivel_alcanzado = ?, logros_json = ?, evaluacion_puntaje = ?, completada = 1, updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ?
    `).run(xpTotal, nivelAlcanzado, logrosJson, evaluacionPuntaje, sessionId)

    // Actualizar perfil del alumno
    this.db.query(`
      UPDATE hl_student_profiles
      SET xp_acumulado = xp_acumulado + ?, sesiones_total = sesiones_total + 1, nivel_actual = ?, updated_at = CURRENT_TIMESTAMP
      WHERE alumno_id = (SELECT alumno_id FROM hl_sessions WHERE session_id = ?)
    `).run(xpTotal, nivelAlcanzado, sessionId)
  }

  getSession(sessionId: string): SessionData | null {
    const row = this.db.query(
      'SELECT * FROM hl_sessions WHERE session_id = ?'
    ).get(sessionId) as Record<string, any> | undefined
    if (!row) return null
    return {
      sessionId: row.session_id,
      alumnoId: row.alumno_id,
      curriculoId: row.curriculo_id,
      xpTotal: row.xp_total,
      nivelAlcanzado: row.nivel_alcanzado,
      logrosJson: row.logros_json,
      nodosCompletados: row.nodos_completados,
      evaluacionPuntaje: row.evaluacion_puntaje,
      completada: !!row.completada,
    }
  }

  getActiveSession(alumnoId: string): SessionData | null {
    const row = this.db.query(
      `SELECT * FROM hl_sessions WHERE alumno_id = ? AND completada = 0 ORDER BY created_at DESC LIMIT 1`
    ).get(alumnoId) as Record<string, any> | undefined
    if (!row) return null
    return {
      sessionId: row.session_id,
      alumnoId: row.alumno_id,
      curriculoId: row.curriculo_id,
      xpTotal: row.xp_total,
      nivelAlcanzado: row.nivel_alcanzado,
      logrosJson: row.logros_json,
      nodosCompletados: row.nodos_completados,
      evaluacionPuntaje: row.evaluacion_puntaje,
      completada: !!row.completada,
    }
  }

  // ─── Session Metrics ────────────────────────────────────────────────

  saveSessionMetrics(metrics: SessionMetrics): void {
    this.db.query(`
      INSERT OR REPLACE INTO hl_session_metrics
        (session_id, alumno_id, curriculo_id, tema, duracion_real_seg, nodos_total, nodos_completados, puntaje_evaluacion, intentos_por_nodo, nodos_dominados, nodos_dificiles, logros_desbloqueados, xp_ganado, completada)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      metrics.sessionId,
      metrics.alumnoId,
      metrics.curriculoId,
      metrics.tema,
      metrics.duracionRealSeg,
      metrics.nodosTotal,
      metrics.nodosCompletados,
      metrics.puntajeEvaluacion,
      metrics.intentosPorNodo,
      metrics.nodosDominados,
      metrics.nodosDificiles,
      metrics.logrosDesbloqueados,
      metrics.xpGanado,
      metrics.completada ? 1 : 0,
    )
  }

  // ─── Node Effectiveness ─────────────────────────────────────────────

  trackNodeInteraction(nodoId: string, agenteTipo: string, tema: string, tipoPedagogico: string, tipoVisual: string, rangoEdad: string, completado: boolean, tiempoSeg: number): void {
    // Generar hash del contenido como ID
    const contentHash = `${nodoId}-${agenteTipo}`

    const existing = this.db.query(
      'SELECT veces_visto, veces_completado FROM hl_node_effectiveness WHERE id = ?'
    ).get(contentHash) as { veces_visto: number; veces_completado: number } | undefined

    if (existing) {
      this.db.query(`
        UPDATE hl_node_effectiveness
        SET veces_visto = veces_visto + 1,
            veces_completado = veces_completado + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(completado ? 1 : 0, contentHash)
    } else {
      this.db.query(`
        INSERT OR REPLACE INTO hl_node_effectiveness
          (id, nodo_content_hash, agente_tipo, tema, tipo_pedagogico, tipo_visual, rango_edad, intentos_promedio, tasa_abandono, tiempo_promedio, veces_visto, veces_completado)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, ?)
      `).run(contentHash, contentHash, agenteTipo, tema, tipoPedagogico, tipoVisual, rangoEdad, completado ? 0 : 1, tiempoSeg, completado ? 1 : 0)
    }
  }

  // ─── Agent Output Traceability ─────────────────────────────────────

  saveAgentOutput(sessionId: string, agentId: string, taskId: string, outputJson: string, durationMs: number, status: 'ok' | 'failed' = 'ok'): void {
    try {
      this.db.query(`
        INSERT INTO hl_session_agent_outputs (session_id, agent_id, task_id, output_json, duration_ms, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(sessionId, agentId, taskId, outputJson, durationMs, status)
    } catch {
      // Non-critical — never block the pipeline
    }
  }

  getAgentOutputs(sessionId: string): Array<{ agent_id: string; task_id: string; output_json: string; duration_ms: number; status: string }> {
    return this.db.query(
      'SELECT agent_id, task_id, output_json, duration_ms, status FROM hl_session_agent_outputs WHERE session_id = ? ORDER BY id ASC'
    ).all(sessionId) as any[]
  }

  // ─── Student Responses ──────────────────────────────────────────────

  saveStudentResponse(sessionId: string, nodeId: string, tipoPedagogico: string, respuesta: string, feedbackJson: string, xpAwarded: number, esCorrecto: boolean): void {
    // Calculate attempt number
    const prev = this.db.query(
      'SELECT COUNT(*) as cnt FROM hl_student_responses WHERE session_id = ? AND node_id = ?'
    ).get(sessionId, nodeId) as { cnt: number }

    this.db.query(`
      INSERT INTO hl_student_responses (session_id, node_id, attempt_num, tipo_pedagogico, respuesta_texto, feedback_json, xp_awarded, es_correcto)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, nodeId, (prev?.cnt ?? 0) + 1, tipoPedagogico, respuesta, feedbackJson, xpAwarded, esCorrecto ? 1 : 0)

    // Update node effectiveness
    this.updateNodeEffectiveness(nodeId, tipoPedagogico, esCorrecto)
  }

  updateNodeEffectiveness(nodeId: string, tipoPedagogico: string, esCorrecto: boolean): void {
    const existing = this.db.query(
      'SELECT veces_visto, veces_completado FROM hl_node_effectiveness WHERE id = ?'
    ).get(nodeId) as { veces_visto: number; veces_completado: number } | undefined

    if (existing) {
      this.db.query(`
        UPDATE hl_node_effectiveness
        SET veces_visto = veces_visto + 1,
            veces_completado = veces_completado + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(esCorrecto ? 1 : 0, nodeId)
    } else {
      this.db.query(`
        INSERT OR REPLACE INTO hl_node_effectiveness
          (id, nodo_content_hash, agente_tipo, tema, tipo_pedagogico, tipo_visual, rango_edad, intentos_promedio, tasa_abandono, tiempo_promedio, veces_visto, veces_completado)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 1, ?)
      `).run(nodeId, nodeId, 'feedback', '', tipoPedagogico, 'text_card', '', esCorrecto ? 0 : 1, esCorrecto ? 1 : 0)
    }
  }

  /** Agrega un logro a la lista de logros desbloqueados de la sesión */
  saveLogro(sessionId: string, logroId: string): void {
    const row = this.db.query(
      'SELECT logros_json FROM hl_sessions WHERE session_id = ?'
    ).get(sessionId) as { logros_json: string } | undefined
    if (!row) return

    const logros: string[] = JSON.parse(row.logros_json ?? '[]')
    if (!logros.includes(logroId)) {
      logros.push(logroId)
      this.db.query(
        'UPDATE hl_sessions SET logros_json = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?'
      ).run(JSON.stringify(logros), sessionId)
    }
  }

  rateSession(sessionId: string, rating: number, comentario?: string): void {
    this.db.query(`
      UPDATE hl_sessions SET rating = ?, rating_comentario = ? WHERE session_id = ?
    `).run(rating, comentario ?? null, sessionId)
  }

  /** Devuelve sesión + curriculo completo (nodos_json) para el gateway */
  getSessionWithCurriculum(sessionId: string): (SessionData & { nodosJson: string; topicSlug: string | null }) | null {
    const row = this.db.query(`
      SELECT s.*, c.nodos_json, c.topic_slug
      FROM hl_sessions s
      LEFT JOIN hl_curricula c ON c.id = s.curriculo_id
      WHERE s.session_id = ?
    `).get(sessionId) as Record<string, any> | undefined
    if (!row) return null
    return {
      sessionId: row.session_id,
      alumnoId: row.alumno_id,
      curriculoId: row.curriculo_id,
      xpTotal: row.xp_total,
      nivelAlcanzado: row.nivel_alcanzado,
      logrosJson: row.logros_json,
      nodosCompletados: row.nodos_completados,
      evaluacionPuntaje: row.evaluacion_puntaje,
      completada: !!row.completada,
      nodosJson: row.nodos_json ?? '[]',
      topicSlug: row.topic_slug ?? null,
    }
  }

  getTopicEffectiveness(topicSlug: string | null): { nodosConMasFallas: string[]; nivelPromedioAprobacion: number } {
    if (!topicSlug) return { nodosConMasFallas: [], nivelPromedioAprobacion: 0 }
    const rows = this.db.query(`
      SELECT tipo_pedagogico, veces_visto, veces_completado
      FROM hl_node_effectiveness
      WHERE tema = ?
      ORDER BY (CAST(veces_completado AS FLOAT) / MAX(veces_visto, 1)) ASC
      LIMIT 5
    `).all(topicSlug) as Array<{ tipo_pedagogico: string; veces_visto: number; veces_completado: number }>

    const nodosConMasFallas = rows
      .filter(r => r.veces_visto > 2)
      .map(r => r.tipo_pedagogico)

    const allRows = this.db.query(`
      SELECT AVG(CAST(veces_completado AS FLOAT) / MAX(veces_visto, 1)) as avg_rate
      FROM hl_node_effectiveness WHERE tema = ?
    `).get(topicSlug) as { avg_rate: number | null }

    return {
      nodosConMasFallas,
      nivelPromedioAprobacion: allRows.avg_rate ? Math.round(allRows.avg_rate * 100) : 0,
    }
  }

  // ─── Metrics Dashboard ──────────────────────────────────────────────

  getAggregateMetrics(): Record<string, any> {
    const totalLessons = this.db.query(
      'SELECT COUNT(*) as count FROM hl_session_metrics'
    ).get() as { count: number }

    const completedLessons = this.db.query(
      'SELECT COUNT(*) as count FROM hl_session_metrics WHERE completada = 1'
    ).get() as { count: number }

    const avgScore = this.db.query(
      'SELECT AVG(puntaje_evaluacion) as avg_score FROM hl_session_metrics WHERE completada = 1'
    ).get() as { avg_score: number | null }

    const avgXP = this.db.query(
      'SELECT AVG(xp_ganado) as avg_xp FROM hl_session_metrics WHERE completada = 1'
    ).get() as { avg_xp: number | null }

    const hardestNodes = this.db.query(`
      SELECT tema, tipo_pedagogico, veces_visto, veces_completado,
             CASE WHEN veces_visto > 0 THEN 1.0 - (CAST(veces_completado AS FLOAT) / veces_visto) ELSE 0 END as tasa_abandono
      FROM hl_node_effectiveness
      WHERE veces_visto > 0
      ORDER BY tasa_abandono DESC
      LIMIT 10
    `).all()

    return {
      totalLessons: totalLessons.count,
      completedLessons: completedLessons.count,
      completionRate: totalLessons.count > 0 ? (completedLessons.count / totalLessons.count * 100).toFixed(1) : 0,
      avgScore: avgScore.avg_score ? Number(avgScore.avg_score).toFixed(1) : null,
      avgXP: avgXP.avg_xp ? Math.round(avgXP.avg_xp) : 0,
      hardestNodes,
    }
  }

  getSessionsByAlumno(alumnoId: string): SessionData[] {
    const rows = this.db.query(
      'SELECT * FROM hl_sessions WHERE alumno_id = ? ORDER BY created_at DESC'
    ).all(alumnoId) as Record<string, any>[]
    return rows.map(row => ({
      sessionId: row.session_id,
      alumnoId: row.alumno_id,
      curriculoId: row.curriculo_id,
      xpTotal: row.xp_total,
      nivelAlcanzado: row.nivel_alcanzado,
      logrosJson: row.logros_json,
      nodosCompletados: row.nodos_completados,
      evaluacionPuntaje: row.evaluacion_puntaje,
      completada: !!row.completada,
    }))
  }
}
