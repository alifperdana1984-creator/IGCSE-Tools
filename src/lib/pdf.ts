import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

function injectPrintStyles(): HTMLStyleElement {
  const style = document.createElement('style')
  style.id = 'pdf-export-override'
  style.textContent = `
    :root {
      --color-emerald-50: #ecfdf5 !important;
      --color-emerald-100: #d1fae5 !important;
      --color-emerald-200: #a7f3d0 !important;
      --color-emerald-500: #10b981 !important;
      --color-emerald-600: #059669 !important;
      --color-emerald-700: #047857 !important;
      --color-emerald-800: #065f46 !important;
      --color-stone-50: #fafaf9 !important;
      --color-stone-100: #f5f5f4 !important;
      --color-stone-200: #e7e5e4 !important;
      --color-stone-300: #d6d3d1 !important;
      --color-stone-600: #57534e !important;
      --color-stone-700: #44403c !important;
      --color-stone-800: #292524 !important;
    }
  `
  document.head.appendChild(style)
  return style
}

export async function exportToPDF(element: HTMLElement, filename: string): Promise<void> {
  const styleTag = injectPrintStyles()
  try {
    const canvas = await html2canvas(element, { useCORS: true, scale: 2 })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const imgH = (canvas.height * pageW) / canvas.width
    let heightLeft = imgH
    let position = 0
    pdf.addImage(imgData, 'PNG', 0, position, pageW, imgH)
    heightLeft -= pageH
    while (heightLeft > 0) {
      position = heightLeft - imgH
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, pageW, imgH)
      heightLeft -= pageH
    }
    pdf.save(filename)
  } finally {
    styleTag.remove()
  }
}
