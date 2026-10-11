"""Serviço de geração de relatórios técnicos de BikeFit em formato PDF.

Utiliza ReportLab para gerar documentos profissionais de alta qualidade contendo:
- Cabeçalho institucional do Athlete Motion
- Dados biométricos e antropométricos do ciclista
- Geometria da bicicleta
- Diagnóstico angular das articulações com conformidade ergonómica
- Análise de Alinhamento KOPS (avanço/recuo de selim)
- Análise de Assimetria Bilateral (membros esquerdo vs direito)
- Desnível Selim-Guiador (Saddle Drop)
- Lista de verificação mecânica de intervenções na bicicleta
- Nota de isenção de responsabilidade biomecânica
"""
from __future__ import annotations

import io
from datetime import datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def generate_bikefit_pdf(
    athlete_data: dict[str, Any],
    bike_data: dict[str, Any] | None,
    session_data: dict[str, Any],
    angles_summary: list[dict[str, Any]],
    kops_data: dict[str, Any] | None = None,
    symmetry_data: list[dict[str, Any]] | None = None,
    saddle_drop_data: dict[str, Any] | None = None,
    language: str = "pt",
) -> bytes:
    """Gera um buffer de bytes contendo o PDF do relatório de BikeFit."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36,
    )

    styles = getSampleStyleSheet()
    is_pt = language.lower() == "pt"

    # Estilos customizados
    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=4,
    )

    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=12,
    )

    section_header_style = ParagraphStyle(
        "SectionHeader",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#1e293b"),
        spaceBefore=10,
        spaceAfter=6,
    )

    body_style = ParagraphStyle(
        "BodyDark",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#334155"),
    )

    bold_body_style = ParagraphStyle(
        "BoldBody",
        parent=body_style,
        fontName="Helvetica-Bold",
    )

    legal_style = ParagraphStyle(
        "LegalNotice",
        parent=styles["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=7,
        leading=10,
        textColor=colors.HexColor("#94a3b8"),
    )

    story: list[Any] = []

    # Cabeçalho Principal
    app_title = "ATHLETE MOTION // BIKEFIT REPORT" if not is_pt else "ATHLETE MOTION // RELATÓRIO TÉCNICO DE BIKEFIT"
    report_sub = (
        f"Automated Biomechanical Analysis & Ergonomic Diagnostic | Generated: {datetime.now().strftime('%d/%m/%Y %H:%M')}"
        if not is_pt
        else f"Análise Biomecânica Computacional e Diagnóstico Ergonómico | Emitido em: {datetime.now().strftime('%d/%m/%Y %H:%M')}"
    )

    story.append(Paragraph(app_title, title_style))
    story.append(Paragraph(report_sub, subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#3b82f6"), spaceAfter=14))

    # Tabela com Dados do Atleta e Bicicleta
    ath_name = athlete_data.get("name", "Ciclista")
    ath_height = f"{athlete_data.get('height_cm', '-')} cm"
    ath_inseam = f"{athlete_data.get('inseam_cm', '-')} cm"
    ath_flex = str(athlete_data.get("flexibility", "medium")).capitalize()
    bike_modality = str(bike_data.get("modality", "road")).upper() if bike_data else "ROAD"
    bike_saddle_current = f"{bike_data.get('current_saddle_height_cm', '-')} cm" if bike_data else "-"
    bike_crank = f"{bike_data.get('crank_length_mm', '-')} mm" if bike_data else "-"

    if is_pt:
        ath_info_data = [
            [
                Paragraph("<b>Atleta:</b>", body_style),
                Paragraph(ath_name, bold_body_style),
                Paragraph("<b>Modalidade:</b>", body_style),
                Paragraph(bike_modality, bold_body_style),
            ],
            [
                Paragraph("<b>Altura Total:</b>", body_style),
                Paragraph(ath_height, body_style),
                Paragraph("<b>Altura Selim Atual:</b>", body_style),
                Paragraph(bike_saddle_current, body_style),
            ],
            [
                Paragraph("<b>Cavalo (Inseam):</b>", body_style),
                Paragraph(ath_inseam, body_style),
                Paragraph("<b>Comprimento Crenque:</b>", body_style),
                Paragraph(bike_crank, body_style),
            ],
            [
                Paragraph("<b>Nível Flexibilidade:</b>", body_style),
                Paragraph(ath_flex, body_style),
                Paragraph("<b>Cadência / Potência:</b>", body_style),
                Paragraph(
                    f"{session_data.get('cadence_rpm', '-')} RPM / {session_data.get('power_watts', '-')} W",
                    body_style,
                ),
            ],
        ]
    else:
        ath_info_data = [
            [
                Paragraph("<b>Rider:</b>", body_style),
                Paragraph(ath_name, bold_body_style),
                Paragraph("<b>Modality:</b>", body_style),
                Paragraph(bike_modality, bold_body_style),
            ],
            [
                Paragraph("<b>Total Height:</b>", body_style),
                Paragraph(ath_height, body_style),
                Paragraph("<b>Current Saddle H:</b>", body_style),
                Paragraph(bike_saddle_current, body_style),
            ],
            [
                Paragraph("<b>Inseam:</b>", body_style),
                Paragraph(ath_inseam, body_style),
                Paragraph("<b>Crank Length:</b>", body_style),
                Paragraph(bike_crank, body_style),
            ],
            [
                Paragraph("<b>Flexibility Level:</b>", body_style),
                Paragraph(ath_flex, body_style),
                Paragraph("<b>Cadence / Power:</b>", body_style),
                Paragraph(
                    f"{session_data.get('cadence_rpm', '-')} RPM / {session_data.get('power_watts', '-')} W",
                    body_style,
                ),
            ],
        ]

    ath_table = Table(ath_info_data, colWidths=[110, 155, 125, 150])
    ath_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(ath_table)
    story.append(Spacer(1, 14))

    # Secção 1: Avaliação Biomecânica das Articulações
    story.append(
        Paragraph("1. Avaliação Angular Dinâmica" if is_pt else "1. Dynamic Joint Angle Assessment", section_header_style)
    )

    angles_table_data = [
        [
            Paragraph("<b>Articulação</b>" if is_pt else "<b>Joint</b>", bold_body_style),
            Paragraph("<b>Ângulo Medido</b>" if is_pt else "<b>Measured</b>", bold_body_style),
            Paragraph("<b>Faixa Ideal</b>" if is_pt else "<b>Optimal Range</b>", bold_body_style),
            Paragraph("<b>Diagnóstico & Ação</b>" if is_pt else "<b>Diagnostic & Action</b>", bold_body_style),
        ]
    ]

    for item in angles_summary:
        joint_name = item.get("name", "N/A")
        val = item.get("angle", 0.0)
        ideal = item.get("range", "145° - 155°")
        is_ok = item.get("compliant", True)
        rec = item.get("recommendation", "Dentro da zona ergonómica recomendada.")

        status_prefix = "✅ " if is_ok else "⚠️ "
        angles_table_data.append(
            [
                Paragraph(joint_name, bold_body_style),
                Paragraph(f"<b>{val:.1f}°</b>", body_style),
                Paragraph(ideal, body_style),
                Paragraph(f"{status_prefix}{rec}", body_style),
            ]
        )

    ang_table = Table(angles_table_data, colWidths=[100, 75, 85, 280])
    ang_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(ang_table)
    story.append(Spacer(1, 14))

    # Secção 2: Testes Especiais Avançados (KOPS, Drop, Simetria)
    story.append(
        Paragraph(
            "2. Métricas Especiais: KOPS, Drop e Simetria"
            if is_pt
            else "2. Advanced Metrics: KOPS, Saddle Drop & Symmetry",
            section_header_style,
        )
    )

    special_data = [
        [
            Paragraph("<b>Teste / Parâmetro</b>" if is_pt else "<b>Test / Metric</b>", bold_body_style),
            Paragraph("<b>Valor Apurado</b>" if is_pt else "<b>Measured</b>", bold_body_style),
            Paragraph("<b>Parecer Clínico</b>" if is_pt else "<b>Clinical Verdict</b>", bold_body_style),
        ]
    ]

    # KOPS
    if kops_data:
        offset = kops_data.get("offset_mm", 0.0)
        sign = "+" if offset > 0 else ""
        verdict = kops_data.get("recommendation", "Alinhado")
        special_data.append(
            [
                Paragraph("<b>KOPS (Avanço/Recuo Selim)</b>", body_style),
                Paragraph(f"{sign}{offset:.1f} mm", bold_body_style),
                Paragraph(verdict, body_style),
            ]
        )

    # Drop
    if saddle_drop_data:
        drop = saddle_drop_data.get("measured_drop_cm", 0.0)
        drop_rec = saddle_drop_data.get("recommendation", "Adequado")
        special_data.append(
            [
                Paragraph("<b>Saddle Drop (Desnível)</b>", body_style),
                Paragraph(f"{drop:.1f} cm", bold_body_style),
                Paragraph(drop_rec, body_style),
            ]
        )

    # Simetria Bilateral
    if symmetry_data:
        for sym in symmetry_data:
            j = sym.get("joint", "Joelho")
            si = sym.get("si", 0.0)
            rec = sym.get("recommendation", "Simétrico")
            special_data.append(
                [
                    Paragraph(f"<b>Simetria Bilateral ({j})</b>", body_style),
                    Paragraph(f"SI: {si:.1f}%", bold_body_style),
                    Paragraph(rec, body_style),
                ]
            )

    if len(special_data) > 1:
        special_table = Table(special_data, colWidths=[160, 100, 280])
        special_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#334155")),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.append(special_table)
    else:
        story.append(
            Paragraph(
                "Nenhuma métrica especial registada nesta sessão."
                if is_pt
                else "No special metrics recorded in this session.",
                body_style,
            )
        )
    story.append(Spacer(1, 14))

    # Secção 3: Checklist Prático de Ajuste na Bicicleta
    story.append(
        Paragraph(
            "3. Guia Prático de Ajustes na Bicicleta (Oficina / Mecânico)"
            if is_pt
            else "3. Practical Bike Setup Checklist (Workshop / Mechanic)",
            section_header_style,
        )
    )

    checklist_items = []
    for item in angles_summary:
        if not item.get("compliant", True):
            checklist_items.append(f"[  ] {item.get('name')}: {item.get('recommendation')}")

    if kops_data and not kops_data.get("is_aligned", True):
        checklist_items.append(f"[  ] Selim (Trilhos): {kops_data.get('recommendation')}")

    if saddle_drop_data and not saddle_drop_data.get("is_compliant", True):
        checklist_items.append(f"[  ] Avanço/Cockpit: {saddle_drop_data.get('recommendation')}")

    if not checklist_items:
        checklist_items.append(
            "Parabéns! Todas as articulações estão em conformidade ergonómica com os parâmetros teóricos."
            if is_pt
            else "Congratulations! All joints match optimal ergonomic parameters."
        )

    for chk in checklist_items:
        story.append(Paragraph(f"• {chk}", body_style))
        story.append(Spacer(1, 3))

    story.append(Spacer(1, 16))

    # Aviso Legal
    disclaimer = (
        "AVISO LEGAL E DE SEGURANÇA: Este relatório é um guia biomecânico e ergonómico gerado computacionalmente "
        "com base em visão artificial e modelos matemáticos padrão (LeMond, Holmes, Pruitt). Não substitui consulta "
        "médica, ortopédica ou avaliação presencial por fisioterapeuta especializado. Ajuste a bicicleta gradualmente."
        if is_pt
        else "DISCLAIMER: This report is a computational biomechanical and ergonomic guide based on computer vision "
        "and standard sizing models (LeMond, Holmes, Pruitt). It does not replace medical or physiotherapy advice. "
        "Make mechanical adjustments progressively."
    )
    story.append(Paragraph(disclaimer, legal_style))

    # Construir documento PDF
    doc.build(story)
    buffer.seek(0)
    return buffer.getvalue()

