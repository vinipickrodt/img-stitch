import React, { useState, useRef, useEffect } from 'react';
import { Upload, Trash2, ArrowUp, ArrowDown, Play, Download, Settings, Image as ImageIcon, CheckCircle, AlertTriangle } from 'lucide-react';

export default function App() {
  const [images, setImages] = useState([]);
  const [config, setConfig] = useState({
    tolerance: 15,       // Tolerância de diferença de cor (0-255)
    sliceHeight: 80,     // Altura da amostra para comparar (px)
    ignoreTop: 0,        // Ignorar cabeçalho (px) - útil para barra de status
    ignoreBottom: 0,     // Ignorar rodapé (px) - útil para barra de navegação
    searchArea: 0.6,     // % da próxima imagem a procurar o match
  });

  const [processingState, setProcessingState] = useState({
    isProcessing: false,
    currentPair: null,
    matches: [],
    finalImage: null,
    status: 'idle' // idle, processing, done
  });

  const finalCanvasRef = useRef(null);

  // Lê os arquivos e cria os elementos de imagem na memória
  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    
    files.forEach(file => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setImages(prev => [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          file,
          url,
          element: img,
          width: img.width,
          height: img.height
        }]);
      };
      img.src = url;
    });
  };

  const removeImage = (id) => {
    setImages(prev => prev.filter(img => img.id !== id));
    resetProcessing();
  };

  const moveImage = (index, direction) => {
    const newImages = [...images];
    if (direction === 'up' && index > 0) {
      [newImages[index - 1], newImages[index]] = [newImages[index], newImages[index - 1]];
    } else if (direction === 'down' && index < newImages.length - 1) {
      [newImages[index + 1], newImages[index]] = [newImages[index], newImages[index + 1]];
    }
    setImages(newImages);
    resetProcessing();
  };

  const resetProcessing = () => {
    setProcessingState({ isProcessing: false, currentPair: null, matches: [], finalImage: null, status: 'idle' });
  };

  // Algoritmo principal de Matching
  const findMatch = async (img1, img2, config) => {
    return new Promise((resolve) => {
      // Usamos setTimeout para não travar a UI durante o cálculo pesado
      setTimeout(() => {
        const w = Math.min(img1.width, img2.width);
        const { sliceHeight, ignoreBottom, ignoreTop, tolerance, searchArea } = config;

        // 1. Extrair a fatia do final da Imagem 1
        const canvas1 = document.createElement('canvas');
        const ctx1 = canvas1.getContext('2d', { willReadFrequently: true });
        canvas1.width = w; canvas1.height = sliceHeight;
        const sliceY = img1.height - ignoreBottom - sliceHeight;
        
        // Se a imagem for menor que a fatia, falha graciosamente
        if (sliceY < 0) return resolve({ bestY: 0, minError: Infinity, success: false });
        
        ctx1.drawImage(img1.element, 0, sliceY, w, sliceHeight, 0, 0, w, sliceHeight);
        const sliceData = ctx1.getImageData(0, 0, w, sliceHeight).data;

        // 2. Extrair a área de busca do topo da Imagem 2
        const searchHeight = Math.floor(img2.height * searchArea);
        const canvas2 = document.createElement('canvas');
        const ctx2 = canvas2.getContext('2d', { willReadFrequently: true });
        canvas2.width = w; canvas2.height = searchHeight;
        
        if (searchHeight <= sliceHeight) return resolve({ bestY: 0, minError: Infinity, success: false });

        ctx2.drawImage(img2.element, 0, ignoreTop, w, searchHeight, 0, 0, w, searchHeight);
        const searchData = ctx2.getImageData(0, 0, w, searchHeight).data;

        let bestY = 0;
        let minError = Infinity;

        // Otimização: Não precisamos checar todos os pixels. Amostramos para velocidade.
        const stepX = 4; // Checa 1 a cada 4 pixels horizontalmente
        const stepY = 2; // Checa 1 a cada 2 pixels verticalmente

        // Desliza a fatia da Img1 sobre a área de busca da Img2
        for (let y = 0; y <= searchHeight - sliceHeight; y += 1) {
          let error = 0;
          let samples = 0;

          for (let sy = 0; sy < sliceHeight; sy += stepY) {
            for (let sx = 0; sx < w; sx += stepX) {
              const idx1 = (sy * w + sx) * 4;
              const idx2 = ((y + sy) * w + sx) * 4;
              
              error += Math.abs(sliceData[idx1] - searchData[idx2]);       // R
              error += Math.abs(sliceData[idx1 + 1] - searchData[idx2 + 1]); // G
              error += Math.abs(sliceData[idx1 + 2] - searchData[idx2 + 2]); // B
              samples++;
            }
          }
          
          const avgError = error / (samples * 3);
          if (avgError < minError) {
            minError = avgError;
            bestY = y;
          }
        }

        const success = minError <= tolerance;
        resolve({
          bestY,
          minError,
          success,
          // Se houve sucesso, a imagem 2 deve ser cortada a partir deste ponto
          cropFromImg2: success ? (ignoreTop + bestY + sliceHeight) : 0
        });
      }, 50);
    });
  };

  const startStitching = async () => {
    if (images.length < 2) return;
    
    setProcessingState(prev => ({ ...prev, isProcessing: true, status: 'processing', matches: [] }));
    const localMatches = [];

    // Processa pares em sequência
    for (let i = 0; i < images.length - 1; i++) {
      setProcessingState(prev => ({ ...prev, currentPair: i }));
      const matchResult = await findMatch(images[i], images[i+1], config);
      
      const matchObj = { pair: [i, i+1], result: matchResult };
      localMatches.push(matchObj);
      
      setProcessingState(prev => ({
        ...prev,
        matches: [...prev.matches, matchObj]
      }));
    }

    // Gerar Imagem Final
    generateFinalImage(localMatches);
  };

  const generateFinalImage = (matches) => {
    const canvas = finalCanvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Calcula a largura final (menor largura entre todas para alinhar)
    const finalWidth = Math.min(...images.map(img => img.width));
    
    // Calcula altura total
    let totalHeight = images[0].height - (matches[0]?.result?.success ? config.ignoreBottom : 0);
    
    for (let i = 1; i < images.length; i++) {
      const match = matches[i-1]?.result;
      const cropTop = match?.success ? match.cropFromImg2 : 0;
      const cropBottom = (i < images.length - 1 && matches[i]?.result?.success) ? config.ignoreBottom : 0;
      
      totalHeight += (images[i].height - cropTop - cropBottom);
    }

    canvas.width = finalWidth;
    canvas.height = totalHeight;

    // Desenha as partes
    let currentY = 0;
    
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      
      if (i === 0) {
        // Primeira imagem
        const drawHeight = img.height - (matches[0]?.result?.success ? config.ignoreBottom : 0);
        ctx.drawImage(img.element, 0, 0, finalWidth, drawHeight, 0, currentY, finalWidth, drawHeight);
        currentY += drawHeight;
      } else {
        // Demais imagens
        const match = matches[i-1]?.result;
        const cropTop = match?.success ? match.cropFromImg2 : 0;
        const cropBottom = (i < images.length - 1 && matches[i]?.result?.success) ? config.ignoreBottom : 0;
        const drawHeight = img.height - cropTop - cropBottom;
        
        ctx.drawImage(img.element, 0, cropTop, finalWidth, drawHeight, 0, currentY, finalWidth, drawHeight);
        currentY += drawHeight;
      }
    }

    setProcessingState(prev => ({
      ...prev,
      isProcessing: false,
      status: 'done',
      finalImage: canvas.toDataURL('image/png')
    }));
  };

  const handleConfigChange = (e) => {
    const { name, value } = e.target;
    setConfig(prev => ({ ...prev, [name]: parseFloat(value) }));
    resetProcessing();
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Stitcher de Prints</h1>
            <p className="text-gray-500 mt-1">Junte múltiplos screenshots em uma única imagem contínua.</p>
          </div>
          <button 
            onClick={startStitching}
            disabled={images.length < 2 || processingState.isProcessing}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all shadow-sm
              ${images.length >= 2 && !processingState.isProcessing
                ? 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md' 
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
          >
            {processingState.isProcessing ? (
              <span className="animate-pulse">Processando...</span>
            ) : (
              <><Play size={20} /> Juntar {images.length} Imagens</>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          
          {/* Coluna Esquerda: Upload e Lista */}
          <div className="md:col-span-5 space-y-6">
            
            {/* Box de Upload */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-blue-200 rounded-xl cursor-pointer bg-blue-50/50 hover:bg-blue-50 transition-colors group">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 text-blue-500 mb-2 group-hover:scale-110 transition-transform" />
                  <p className="text-sm text-gray-600"><span className="font-semibold text-blue-600">Clique para upload</span> ou arraste</p>
                </div>
                <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>

              {/* Lista de Imagens */}
              <div className="mt-4 space-y-2 max-h-[400px] overflow-y-auto pr-2">
                {images.map((img, index) => (
                  <div key={img.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200 group hover:border-blue-300 transition-colors">
                    <div className="flex flex-col gap-1">
                      <button onClick={() => moveImage(index, 'up')} disabled={index === 0} className="text-gray-400 hover:text-blue-600 disabled:opacity-30">
                        <ArrowUp size={16} />
                      </button>
                      <button onClick={() => moveImage(index, 'down')} disabled={index === images.length - 1} className="text-gray-400 hover:text-blue-600 disabled:opacity-30">
                        <ArrowDown size={16} />
                      </button>
                    </div>
                    
                    <div className="w-12 h-16 rounded overflow-hidden bg-gray-200 flex-shrink-0 border border-gray-300">
                      <img src={img.url} alt={`Upload ${index}`} className="w-full h-full object-cover" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">Imagem {index + 1}</p>
                      <p className="text-xs text-gray-400">{img.width}x{img.height}</p>
                    </div>
                    
                    <button onClick={() => removeImage(img.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
                {images.length === 0 && (
                  <div className="text-center py-8 text-gray-400 text-sm flex flex-col items-center">
                    <ImageIcon size={32} className="mb-2 opacity-50" />
                    Nenhuma imagem adicionada
                  </div>
                )}
              </div>
            </div>

            {/* Configurações Avançadas */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
              <h3 className="font-semibold flex items-center gap-2 text-gray-700">
                <Settings size={18} /> Ajustes do Algoritmo
              </h3>
              
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <label className="text-gray-600 font-medium">Tolerância a diferenças</label>
                    <span className="text-blue-600 font-semibold">{config.tolerance}</span>
                  </div>
                  <input type="range" name="tolerance" min="0" max="50" step="1" value={config.tolerance} onChange={handleConfigChange} className="w-full accent-blue-600" />
                  <p className="text-xs text-gray-400 mt-1">Aumente se as imagens tiverem artefatos de compressão.</p>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <label className="text-gray-600 font-medium">Tamanho da amostra de busca</label>
                    <span className="text-blue-600 font-semibold">{config.sliceHeight}px</span>
                  </div>
                  <input type="range" name="sliceHeight" min="20" max="200" step="10" value={config.sliceHeight} onChange={handleConfigChange} className="w-full accent-blue-600" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-600 font-medium block mb-1">Ignorar Topo (px)</label>
                    <input type="number" name="ignoreTop" value={config.ignoreTop} onChange={handleConfigChange} className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600 font-medium block mb-1">Ignorar Rodapé (px)</label>
                    <input type="number" name="ignoreBottom" value={config.ignoreBottom} onChange={handleConfigChange} className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Coluna Direita: Visualização e Resultado */}
          <div className="md:col-span-7">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-full min-h-[500px] flex flex-col">
              
              {/* Status Visual do Processamento */}
              {processingState.status !== 'idle' && (
                <div className="mb-6 space-y-3 bg-gray-50 p-4 rounded-xl border border-gray-200">
                  <h3 className="font-semibold text-gray-700">Progresso do Matching</h3>
                  <div className="flex flex-wrap gap-2">
                    {processingState.matches.map((match, idx) => (
                      <div key={idx} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border
                        ${match.result.success ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                        {match.result.success ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                        Img {match.pair[0]+1} + {match.pair[1]+1}
                        <span className="text-xs opacity-70 ml-1">(Erro: {match.result.minError.toFixed(1)})</span>
                      </div>
                    ))}
                    {processingState.isProcessing && processingState.currentPair !== null && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
                        <Play size={16} className="animate-spin" /> Analisando Img {processingState.currentPair + 1} e {processingState.currentPair + 2}...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Área do Canvas de Resultado */}
              <div className="flex-1 flex items-center justify-center bg-gray-100 rounded-xl overflow-hidden relative border border-gray-200">
                {processingState.status === 'idle' && (
                  <div className="text-gray-400 text-center">
                    <ImageIcon size={48} className="mx-auto mb-3 opacity-30" />
                    <p>Adicione imagens e clique em "Juntar Imagens"</p>
                  </div>
                )}
                
                {/* Canvas oculto que gera a imagem */}
                <canvas ref={finalCanvasRef} className="hidden" />
                
                {/* Imagem Final Gerada para visualização */}
                {processingState.finalImage && (
                  <div className="w-full h-full overflow-auto flex justify-center p-4">
                     <img src={processingState.finalImage} alt="Resultado" className="max-w-full shadow-lg rounded object-contain border border-gray-300" />
                  </div>
                )}
              </div>

              {/* Botão de Download */}
              {processingState.status === 'done' && processingState.finalImage && (
                <div className="mt-6 flex justify-end">
                  <a 
                    href={processingState.finalImage} 
                    download="screenshot_longo.png"
                    className="flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-green-700 transition-colors shadow-sm"
                  >
                    <Download size={20} /> Baixar Imagem Completa
                  </a>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}