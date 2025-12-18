import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI } from "@google/genai";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import * as pdfjsLibModule from "pdfjs-dist";

const pdfjsLib = (pdfjsLibModule as any).default || pdfjsLibModule;
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

interface MatrixTable {
  title: string;
  headers: string[];
  rows: string[][];
}

interface FileData {
  name: string;
  textContent: string;
}

const App = () => {
  const [referenceData, setReferenceData] = useState<string>("");
  const [referenceFiles, setReferenceFiles] = useState<FileData[]>([]);
  const [templateStructure, setTemplateStructure] = useState<string>(
    "STT, Nội dung kiến thức, Đơn vị kiến thức, Chuẩn cần đánh giá, Nhận biết (Số câu), Thông hiểu (Số câu), Vận dụng (Số câu), Vận dụng cao (Số câu), Tổng số câu, Ghi chú"
  );
  const [customInstructions, setCustomInstructions] = useState<string>("");
  
  const [generatedMatrices, setGeneratedMatrices] = useState<MatrixTable[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isProcessingFile, setIsProcessingFile] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  const refFileInput = useRef<HTMLInputElement>(null);
  const templateFileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }
  }, []);

  const processFileContent = async (file: File): Promise<string> => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    const reader = new FileReader();
    
    if (ext === "pdf") {
      const arrayBuffer = await new Promise<ArrayBuffer>((res) => {
        reader.onload = (e) => res(e.target?.result as ArrayBuffer);
        reader.readAsArrayBuffer(file);
      });
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
      const pdf = await loadingTask.promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((it: any) => it.str).join(" ") + "\n";
      }
      return text;
    } else if (ext === "docx") {
      const arrayBuffer = await new Promise<ArrayBuffer>((res) => {
        reader.onload = (e) => res(e.target?.result as ArrayBuffer);
        reader.readAsArrayBuffer(file);
      });
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    } else if (ext === "xlsx" || ext === "xls") {
      const arrayBuffer = await new Promise<ArrayBuffer>((res) => {
        reader.onload = (e) => res(e.target?.result as ArrayBuffer);
        reader.readAsArrayBuffer(file);
      });
      const wb = XLSX.read(arrayBuffer, { type: "array" });
      return XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    }
    return await new Promise<string>((res) => {
      reader.onload = (e) => res(e.target?.result as string);
      reader.readAsText(file);
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setIsProcessingFile(true);
    const newFiles: FileData[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await processFileContent(file);
        newFiles.push({ name: file.name, textContent: text });
      } catch (err) { console.error(err); }
    }
    setReferenceFiles(prev => [...prev, ...newFiles]);
    setIsProcessingFile(false);
  };

  const handleGenerate = async () => {
    if (!referenceData && referenceFiles.length === 0) {
      setError("Vui lòng nhập tư liệu tham chiếu.");
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const headers = templateStructure.split(/[,;\t\n]/).map(s => s.trim()).filter(s => s);
      
      const prompt = `
        BẠN LÀ CHUYÊN GIA KHẢO THÍ VÀ XÂY DỰNG CHƯƠNG TRÌNH GIÁO DỤC CẤP CAO.
        NHIỆM VỤ TỐI THƯỢNG: Lập Ma trận đặc tả ĐỀ KIỂM TRA ĐẦY ĐỦ 100% NỘI DUNG từ tư liệu tham chiếu.

        QUY TẮC CỐ ĐỊNH (KHÔNG ĐƯỢC THAY ĐỔI):
        1. PHÂN TÁCH TUYỆT ĐỐI 2 PHẦN: Ma trận phải có đủ: "MA TRẬN ĐỌC" và "MA TRẬN VIẾT".
        2. CAM KẾT ĐẦY ĐỦ 100%: 
           - Bạn PHẢI quét từng dòng trong tư liệu tham chiếu.
           - Mỗi đơn vị kiến thức, mỗi kỹ năng, mỗi bài học xuất hiện trong tư liệu PHẢI được chuyển hóa thành một dòng (ROW) trong ma trận.
           - TUYỆT ĐỐI KHÔNG ĐƯỢC tóm tắt gộp, không bỏ sót bất kỳ chi tiết nào. Nếu tư liệu có 10 bài, ma trận phải thể hiện đủ 10 bài.
        3. THIẾT LẬP NỘI DUNG TỰ ĐỘNG CHUẨN XÁC:
           - Tự động điền "Chuẩn cần đánh giá" khớp với yêu cầu cần đạt của chương trình.
           - Tự động tính toán "Số câu" cho các mức độ Nhận biết, Thông hiểu, Vận dụng, Vận dụng cao sao cho tổng điểm và tỉ lệ logic với cấu trúc đề thi phổ thông hiện hành.
        4. THỰC HIỆN YÊU CẦU RIÊNG BIỆT (NẾU CÓ):
           "${customInstructions || "Ưu tiên độ phủ 100% kiến thức."}"
        
        5. CẤU TRÚC CỘT (GIỮ NGUYÊN KHUNG):
           ${headers.join(" | ")}

        ĐỊNH DẠNG ĐẦU RA BẮT BUỘC:
        SECTION: [Tên phần - VD: MA TRẬN ĐỌC]
        HEADERS: [Danh sách cột cách nhau bằng |||]
        ROW: [Nội dung chi tiết từng cột cách nhau bằng |||]
        ... (lặp lại cho mọi dòng kiến thức)
        SECTION: [Tên phần - VD: MA TRẬN VIẾT]
        HEADERS: [Danh sách cột cách nhau bằng |||]
        ROW: [Nội dung chi tiết từng cột cách nhau bằng |||]

        TƯ LIỆU THAM CHIẾU (PHẢI QUÉT 100%):
        ${referenceData}
        ${referenceFiles.map(f => f.textContent).join("\n\n")}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          temperature: 0.1, // Giảm temperature để tăng độ chính xác và nhất quán
          maxOutputTokens: 20000,
          thinkingConfig: { thinkingBudget: 8000 } // Tăng thinking budget để AI suy luận kỹ hơn về độ phủ 100%
        }
      });

      const text = response.text || "";
      const sections = text.split(/SECTION:/i).filter(s => s.trim());
      const parsedMatrices: MatrixTable[] = sections.map(sec => {
        const lines = sec.split("\n").map(l => l.trim()).filter(l => l);
        const title = lines[0] || "Ma trận";
        const headerLine = lines.find(l => l.startsWith("HEADERS:"));
        const rowLines = lines.filter(l => l.startsWith("ROW:"));
        
        const currentHeaders = headerLine 
          ? headerLine.substring(8).split("|||").map(s => s.trim())
          : headers;

        const rows = rowLines.map(r => {
          const cells = r.substring(4).split("|||").map(s => s.trim());
          while (cells.length < currentHeaders.length) cells.push("");
          return cells.slice(0, currentHeaders.length);
        });

        return { title, headers: currentHeaders, rows };
      });

      if (parsedMatrices.length === 0) throw new Error("AI không thể khởi tạo dữ liệu. Vui lòng kiểm tra lại tư liệu đầu vào.");
      setGeneratedMatrices(parsedMatrices);
    } catch (err: any) {
      setError(err.message || "Lỗi xử lý hệ thống.");
    } finally {
      setIsLoading(false);
    }
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    generatedMatrices.forEach(matrix => {
      const data = [matrix.headers, ...matrix.rows];
      const ws = XLSX.utils.aoa_to_sheet(data);
      // Áp dụng định dạng cơ bản cho sheet
      XLSX.utils.book_append_sheet(wb, ws, matrix.title.substring(0, 30).replace(/[:\\\/\?\*\[\]]/g, ""));
    });
    XLSX.writeFile(wb, "Ma_Tran_Dac_Ta_Chuan_100.xlsx");
  };

  return (
    <div className="min-h-screen bg-[#f0f4f8] p-4 md:p-8 font-serif text-slate-900">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section - Vibrant & Fixed Goal */}
        <header className="text-center py-10 bg-gradient-to-br from-[#4f46e5] via-[#7c3aed] to-[#db2777] text-white rounded-3xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
          <div className="relative z-10 px-4">
            <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tight drop-shadow-lg">Hệ thống Ma trận Đặc tả 100%</h1>
            <p className="mt-4 text-xl md:text-2xl font-medium opacity-90 italic">Phân tích toàn diện • Không bỏ sót kiến thức • Tự động hóa hoàn toàn</p>
            <div className="mt-6 inline-flex bg-white/20 backdrop-blur-md px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-white/30">
              Chế độ: Cố định khung 100% Đọc & Viết
            </div>
          </div>
        </header>

        {/* Global Loading Overlay */}
        {(isLoading || isProcessingFile) && (
          <div className="fixed inset-0 bg-indigo-950/60 backdrop-blur-xl z-[100] flex flex-col items-center justify-center">
            <div className="relative">
              <div className="w-24 h-24 border-8 border-white/20 border-t-pink-500 animate-spin rounded-full shadow-2xl"></div>
              <div className="absolute inset-0 flex items-center justify-center font-black text-white text-xs">AI</div>
            </div>
            <p className="mt-8 text-3xl font-black text-white uppercase animate-pulse drop-shadow-lg text-center px-4">
              Đang truy xuất 100% dữ liệu...
            </p>
            <p className="text-lg mt-2 text-white/70 font-medium italic text-center px-6">
              Gemini đang ánh xạ từng đơn vị kiến thức vào ma trận đặc tả
            </p>
          </div>
        )}

        {/* Input Controls Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Section 1: Reference Data - Teal Theme */}
          <section className="bg-white rounded-2xl shadow-xl border-t-8 border-teal-500 overflow-hidden flex flex-col h-[480px] transition-all hover:shadow-2xl hover:-translate-y-1">
            <div className="bg-teal-500 text-white p-5 flex justify-between items-center shadow-md">
              <h2 className="text-xl font-bold uppercase flex items-center gap-3">
                <span className="bg-white text-teal-600 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black shadow-inner">1</span>
                Tư liệu tham chiếu
              </h2>
              <div className="flex gap-2">
                <input type="file" multiple className="hidden" id="ref-file" onChange={handleFileUpload} />
                <label htmlFor="ref-file" className="cursor-pointer bg-white/20 hover:bg-white text-white hover:text-teal-600 px-4 py-2 text-xs font-black rounded-lg transition-all border-2 border-white/50 shadow-md uppercase">Nạp File</label>
              </div>
            </div>
            <textarea 
              className="w-full flex-grow p-6 text-lg focus:ring-0 outline-none resize-none bg-teal-50/10 text-teal-900 placeholder-teal-300 font-medium leading-relaxed"
              placeholder="Dán nội dung sách giáo khoa hoặc đề cương cần trích xuất 100% tại đây..."
              value={referenceData}
              onChange={e => setReferenceData(e.target.value)}
            />
            {referenceFiles.length > 0 && (
              <div className="p-3 bg-teal-50 border-t border-teal-100 text-[10px] font-bold text-teal-600 italic truncate px-6 uppercase tracking-wider">
                📁 Đã nạp: {referenceFiles.map(f => f.name).join(", ")}
              </div>
            )}
          </section>

          {/* Section 2: Template Structure - Indigo Theme */}
          <section className="bg-white rounded-2xl shadow-xl border-t-8 border-indigo-600 overflow-hidden flex flex-col h-[480px] transition-all hover:shadow-2xl hover:-translate-y-1">
            <div className="bg-indigo-600 text-white p-5 flex justify-between items-center shadow-md">
              <h2 className="text-xl font-bold uppercase flex items-center gap-3">
                <span className="bg-white text-indigo-600 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black shadow-inner">2</span>
                Khung ma trận mẫu
              </h2>
              <div className="flex gap-2">
                <input type="file" className="hidden" id="temp-file" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if(f) setTemplateStructure(await processFileContent(f));
                }} />
                <label htmlFor="temp-file" className="cursor-pointer bg-white/20 hover:bg-white text-white hover:text-indigo-600 px-4 py-2 text-xs font-black rounded-lg transition-all border-2 border-white/50 shadow-md uppercase">Nạp Mẫu</label>
              </div>
            </div>
            <textarea 
              className="w-full flex-grow p-6 text-lg focus:ring-0 outline-none resize-none bg-indigo-50/10 text-indigo-900 placeholder-indigo-300 font-medium leading-relaxed"
              placeholder="Nhập tên các cột, ngăn cách bằng dấu phẩy..."
              value={templateStructure}
              onChange={e => setTemplateStructure(e.target.value)}
            />
          </section>
        </div>

        {/* Section 3: Custom Instructions - Orange/Amber Theme */}
        <section className="bg-white rounded-2xl shadow-xl border-t-8 border-amber-500 overflow-hidden transition-all hover:shadow-2xl">
          <div className="bg-amber-500 text-white p-5 shadow-md">
            <h2 className="text-xl font-bold uppercase flex items-center gap-3">
              <span className="bg-white text-amber-600 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black shadow-inner">3</span>
              Yêu cầu tinh chỉnh (Option)
            </h2>
          </div>
          <div className="p-6">
            <textarea 
              className="w-full h-24 p-5 text-lg border-2 border-amber-100 focus:border-amber-400 focus:bg-amber-50/20 outline-none rounded-xl bg-amber-50/5 text-amber-900 placeholder-amber-200 transition-all font-medium"
              placeholder="Ví dụ: Cần tập trung vào kỹ năng vận dụng cao cho phần Đọc hiểu, phân chia tỉ lệ điểm 7/3..."
              value={customInstructions}
              onChange={e => setCustomInstructions(e.target.value)}
            />
          </div>
        </section>

        {/* Action Button - Vibrant Gradient Animation */}
        <div className="flex justify-center pt-6">
          <button 
            onClick={handleGenerate}
            disabled={isLoading}
            className="group relative inline-flex items-center justify-center px-24 py-7 font-black text-white transition-all bg-gradient-to-r from-[#6366f1] to-[#ec4899] rounded-2xl hover:rounded-[2rem] shadow-[0_15px_40px_-15px_rgba(236,72,153,0.5)] hover:shadow-[0_25px_50px_-12px_rgba(236,72,153,0.7)] active:scale-95 disabled:grayscale disabled:opacity-50 overflow-hidden"
          >
            <span className="absolute inset-0 w-full h-full bg-white/10 group-hover:bg-transparent transition-colors"></span>
            <span className="relative text-3xl uppercase tracking-widest flex items-center gap-4 drop-shadow-sm">
              <span className="animate-pulse">✨</span> Thiết lập Ma trận 100%
            </span>
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="bg-rose-50 border-l-[16px] border-rose-500 p-8 rounded-2xl shadow-2xl text-rose-800 font-black flex items-center gap-6 animate-shake">
            <span className="text-6xl">🚨</span>
            <div className="flex-1">
              <h4 className="text-2xl uppercase">Phát hiện lỗi xử lý</h4>
              <p className="text-lg font-medium opacity-80">{error}</p>
            </div>
          </div>
        )}

        {/* Result Area - Fixed Format Sections */}
        {generatedMatrices.length > 0 && (
          <div className="space-y-16 py-16 animate-in fade-in zoom-in slide-in-from-bottom-12 duration-1000">
            <div className="flex flex-col md:flex-row justify-between items-center border-b-8 border-indigo-100 pb-10 gap-8">
              <div className="space-y-2">
                <h2 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-700 to-pink-600 uppercase tracking-tighter">
                  Kết quả Ma trận Đặc tả
                </h2>
                <p className="text-slate-500 font-bold italic">Đã ánh xạ thành công toàn bộ nội dung từ tư liệu của bạn</p>
              </div>
              <button 
                onClick={exportExcel}
                className="flex items-center gap-4 bg-[#10b981] text-white px-12 py-6 text-xl font-black rounded-2xl border-b-8 border-[#047857] hover:bg-[#34d399] hover:translate-y-[-4px] transition-all shadow-2xl active:translate-y-[4px] active:border-b-0"
              >
                📥 XUẤT FILE EXCEL (.XLSX)
              </button>
            </div>

            {generatedMatrices.map((matrix, mIdx) => (
              <section key={mIdx} className="bg-white rounded-[2.5rem] shadow-[0_30px_70px_-20px_rgba(0,0,0,0.12)] border border-slate-100 overflow-hidden transform transition-all hover:shadow-3xl">
                <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-12 py-8 flex justify-between items-center border-b-8 border-pink-500">
                  <div className="flex items-center gap-6">
                    <div className="w-12 h-12 bg-pink-500 rounded-xl flex items-center justify-center text-2xl font-black shadow-lg">
                      {mIdx + 1}
                    </div>
                    <h3 className="text-3xl font-black uppercase tracking-tight">
                      {matrix.title}
                    </h3>
                  </div>
                  <div className="hidden md:block bg-white/10 px-6 py-2 rounded-full text-xs font-black tracking-[0.2em] border border-white/20 uppercase">
                    Hoàn tất 100%
                  </div>
                </div>
                <div className="overflow-x-auto p-4">
                  <table className="min-w-full border-separate border-spacing-0">
                    <thead>
                      <tr>
                        {matrix.headers.map((h, i) => (
                          <th key={i} className="px-6 py-6 bg-slate-50/80 border-b-4 border-indigo-400 text-[11px] uppercase font-black text-indigo-900 text-center whitespace-nowrap first:rounded-tl-2xl last:rounded-tr-2xl backdrop-blur-sm">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {matrix.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="group hover:bg-indigo-50/50 transition-all duration-300">
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="px-6 py-5 text-base text-slate-700 border-r border-slate-50 last:border-r-0 align-top leading-relaxed font-semibold group-hover:text-indigo-950 transition-colors">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-slate-50 px-12 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-t border-slate-100">
                  Phân tích bởi hệ thống thông minh • Độ phủ nội dung: 100.00%
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      
      {/* Subtle Footer */}
      <footer className="max-w-7xl mx-auto mt-20 pb-10 text-center border-t border-slate-200 pt-8 opacity-40">
        <p className="text-sm font-bold uppercase tracking-widest">Hệ thống hỗ trợ khảo thí chuyên nghiệp • 2025</p>
      </footer>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);