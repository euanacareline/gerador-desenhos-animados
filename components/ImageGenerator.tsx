import React, { useState, useCallback, useEffect } from 'react';
import { generateImagePrompt, generateImage, generateSpeech, getVerseText } from '../services/geminiService';
import Spinner from './Spinner';
import { DownloadIcon } from './icons/DownloadIcon';

// Helper to write string to DataView
const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
};

// Converts raw PCM data (from base64) to a WAV Blob that browsers can play
const createWavBlob = (base64: string): Blob => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const pcmData = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        pcmData[i] = binaryString.charCodeAt(i);
    }

    const sampleRate = 24000; // As per Gemini TTS documentation
    const numChannels = 1;
    const bitsPerSample = 16;
    const dataSize = pcmData.length;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');

    // "fmt " sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Sub-chunk size
    view.setUint16(20, 1, true); // Audio format (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // Byte rate
    view.setUint16(32, numChannels * (bitsPerSample / 8), true); // Block align
    view.setUint16(34, bitsPerSample, true);

    // "data" sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Write PCM data
    for (let i = 0; i < dataSize; i++) {
        view.setUint8(44 + i, pcmData[i]);
    }

    return new Blob([view], { type: 'audio/wav' });
};


const LANGUAGES = {
    'pt-BR': 'Português',
    'en-US': 'Inglês',
    'es-ES': 'Espanhol',
    'fr-FR': 'Francês',
    'de-DE': 'Alemão',
};

const ImageGenerator: React.FC = () => {
  const [bibleReference, setBibleReference] = useState('');
  const [promptText, setPromptText] = useState('');
  const [characterDescriptions, setCharacterDescriptions] = useState<Record<string, string> | null>(null);
  const [isSequenceActive, setIsSequenceActive] = useState(false);
  
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const [isImageLoading, setIsImageLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16');

  const [language, setLanguage] = useState('pt-BR');
  const [voiceType, setVoiceType] = useState('adulta'); // 'adulta' | 'infantil'
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [narratedText, setNarratedText] = useState<string | null>(null);
  const [textForNarration, setTextForNarration] = useState('');
  const [isFetchingVerse, setIsFetchingVerse] = useState(false);

  // Bible Reference Parsers
  const parseBibleRef = (ref: string): { book: string; chapter: number; verse: number } | null => {
    const match = ref.trim().match(/^(.*\D)\s*(\d+):(\d+)$/);
    if (!match) return null;
    return {
        book: match[1].trim(),
        chapter: parseInt(match[2], 10),
        verse: parseInt(match[3], 10),
    };
  };

  const formatBibleRef = (parsed: { book: string; chapter: number; verse: number }): string => {
      return `${parsed.book} ${parsed.chapter}:${parsed.verse}`;
  };

  const getNextVerseRef = useCallback(() => {
    const parsed = parseBibleRef(bibleReference);
    return parsed ? formatBibleRef({ ...parsed, verse: parsed.verse + 1 }) : '';
  }, [bibleReference]);


  // Cleanup object URL when component unmounts or URL changes
  useEffect(() => {
    return () => {
        if (generatedAudioUrl) {
            URL.revokeObjectURL(generatedAudioUrl);
        }
    };
  }, [generatedAudioUrl]);

  const handleStartNew = () => {
    setIsSequenceActive(false);
    setCharacterDescriptions(null);
    setGeneratedImage(null);
    setImageError(null);
    setPromptError(null);
    setPromptText('');
    setBibleReference('');
    setGeneratedAudioUrl(null);
    setTextForNarration('');
    setNarratedText(null);
  };

  const handleGeneratePrompt = useCallback(async () => {
    if (!bibleReference.trim()) return;

    // Reset states but keep bibleReference
    setIsSequenceActive(false);
    setCharacterDescriptions(null);
    setGeneratedImage(null);
    setImageError(null);
    setPromptError(null);
    setPromptText('');
    setGeneratedAudioUrl(null);
    setTextForNarration('');
    setNarratedText(null);

    setIsPromptLoading(true);

    try {
      const { scenePrompt, characterDescriptions: newChars } = await generateImagePrompt(bibleReference);
      setPromptText(scenePrompt);
      setCharacterDescriptions(newChars);
    } catch (err: any) {
      console.error(err);
      if (err.toString().includes('500') || err.toString().includes('Rpc failed')) {
        setPromptError('Ocorreu um erro de comunicação com o servidor. Por favor, tente novamente em alguns instantes.');
      } else {
        setPromptError(err.message || 'Ocorreu um erro ao gerar o prompt. Tente um versículo diferente.');
      }
    } finally {
      setIsPromptLoading(false);
    }
  }, [bibleReference]);

  const handleGenerateImage = useCallback(async () => {
    if (!promptText.trim() || isImageLoading) return;

    setIsImageLoading(true);
    setImageError(null);
    setGeneratedImage(null);

    try {
      const imageBase64 = await generateImage(promptText, aspectRatio);
      setGeneratedImage(`data:image/jpeg;base64,${imageBase64}`);
      setIsSequenceActive(true);
    } catch (err: any) {
      console.error(err);
      if (err.toString().includes('500') || err.toString().includes('Rpc failed')) {
        setImageError('Ocorreu um erro de comunicação com o servidor. Por favor, tente novamente em alguns instantes.');
      } else {
        setImageError(err.message || 'Ocorreu um erro ao gerar a imagem. Por favor, tente novamente.');
      }
    } finally {
      setIsImageLoading(false);
    }
  }, [promptText, isImageLoading, aspectRatio]);

  const handleGenerateNextVerse = useCallback(async () => {
    const nextVerseRef = getNextVerseRef();
    if (!nextVerseRef || !characterDescriptions) return;
    
    setIsImageLoading(true);
    setImageError(null);
    // Keep the last image visible during loading for a better UX
    // setGeneratedImage(null); 
    setPromptError(null);
    const lastValidRef = bibleReference;
    
    try {
      setBibleReference(nextVerseRef);
      
      const { scenePrompt, characterDescriptions: updatedChars } = await generateImagePrompt(nextVerseRef, characterDescriptions);
      setPromptText(scenePrompt);
      setCharacterDescriptions(updatedChars);
      
      const imageBase64 = await generateImage(scenePrompt, aspectRatio);
      setGeneratedImage(`data:image/jpeg;base64,${imageBase64}`);
      setIsSequenceActive(true); // Ensure sequence continues
      
    // FIX: Added curly braces to the catch block to fix a syntax error that was causing cascading scope issues.
    } catch (err: any) {
      if (err instanceof Error && err.message.includes('VERSE_NOT_FOUND')) {
        setImageError("Fim do capítulo. Inicie uma nova cena.");
        setIsSequenceActive(false); // End the sequence
        setBibleReference(lastValidRef); // Revert to the last valid reference
      } else if (err.toString().includes('500') || err.toString().includes('Rpc failed')) {
        setImageError('Ocorreu um erro de comunicação com o servidor. Por favor, tente novamente em alguns instantes.');
        setBibleReference(lastValidRef);
      } else {
        setImageError((err as Error).message || 'Falha ao gerar o próximo versículo.');
        setBibleReference(lastValidRef);
      }
    } finally {
      setIsImageLoading(false);
    }
  }, [characterDescriptions, aspectRatio, getNextVerseRef, bibleReference]);

  const handleDownload = (base64Image: string, fileNameSuffix: string) => {
    if (!base64Image) return;
    const link = document.createElement('a');
    link.href = base64Image;
    const fileName = `${bibleReference.replace(/[: ]/g, '_').toLowerCase()}_${fileNameSuffix}.jpg`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFetchVerseText = useCallback(async () => {
    if (!bibleReference.trim() || isFetchingVerse) return;

    setIsFetchingVerse(true);
    setAudioError(null);
    setTextForNarration('');

    try {
        const verseText = await getVerseText(bibleReference, language);
        setTextForNarration(verseText);
    } catch (err: any) {
        console.error(err);
        if (err.toString().includes('500') || err.toString().includes('Rpc failed')) {
            setAudioError('Ocorreu um erro de comunicação com o servidor. Por favor, tente novamente.');
        } else {
            setAudioError('Ocorreu um erro ao buscar o texto. Verifique a referência ou tente novamente.');
        }
    } finally {
        setIsFetchingVerse(false);
    }
  }, [bibleReference, language, isFetchingVerse]);

  const handleGenerateAudioClick = useCallback(async () => {
    if (!textForNarration.trim() || isAudioLoading) return;

    setIsAudioLoading(true);
    setAudioError(null);
    if (generatedAudioUrl) {
        URL.revokeObjectURL(generatedAudioUrl);
    }
    setGeneratedAudioUrl(null);
    setNarratedText(null);

    try {
        const audioBase64 = await generateSpeech(textForNarration, voiceType as 'adulta' | 'infantil');
        const audioBlob = createWavBlob(audioBase64);
        const url = URL.createObjectURL(audioBlob);
        setGeneratedAudioUrl(url);
        setNarratedText(textForNarration);
    } catch (err: any) {
        console.error(err);
        if (err.toString().includes('500') || err.toString().includes('Rpc failed')) {
            setAudioError('Ocorreu um erro de comunicação com o servidor. Por favor, tente novamente.');
        } else {
            setAudioError('Ocorreu um erro ao gerar o áudio. Por favor, tente novamente.');
        }
    } finally {
        setIsAudioLoading(false);
    }
  }, [textForNarration, voiceType, isAudioLoading, generatedAudioUrl]);

  const isAnyLoading = isPromptLoading || isImageLoading || isAudioLoading || isFetchingVerse;

  return (
    <div className="flex flex-col items-center gap-8">
      {/* Input Section */}
      <div className="w-full max-w-2xl bg-slate-800/60 rounded-xl p-6 shadow-2xl shadow-cyan-500/10 border border-slate-700">
        <div className="flex items-end gap-4">
          <div className="flex-grow">
            <label htmlFor="bible-ref" className="block text-lg font-medium text-gray-300 mb-2">Capítulo e Versículo da Bíblia</label>
            <input
              id="bible-ref"
              type="text"
              value={bibleReference}
              onChange={(e) => setBibleReference(e.target.value)}
              placeholder="Ex: Gênesis 1:1"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 focus:outline-none transition duration-300 disabled:bg-slate-800 disabled:cursor-not-allowed"
              disabled={isAnyLoading || isSequenceActive}
            />
          </div>
          {isSequenceActive && (
            <button
              onClick={handleStartNew}
              disabled={isAnyLoading}
              className="bg-red-600/80 text-white font-bold py-3 px-5 rounded-lg hover:bg-red-700 transition duration-300 disabled:opacity-50"
            >
              Nova Cena
            </button>
          )}
        </div>
      </div>

      {/* Prompt Generator Section */}
      <div className="w-full max-w-2xl bg-slate-800/60 rounded-xl p-6 shadow-2xl shadow-cyan-500/10 border border-slate-700">
        <h2 className="text-xl font-semibold text-center text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 mb-2">
            Passo 1: Crie o Prompt da Cena
        </h2>
        <div className="flex flex-col gap-4">
          <button
            onClick={handleGeneratePrompt}
            disabled={!bibleReference.trim() || isAnyLoading || isSequenceActive}
            className="bg-gradient-to-r from-slate-600 to-slate-700 text-white font-bold py-3 px-6 rounded-lg hover:from-slate-700 hover:to-slate-800 transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center w-full"
          >
            {isPromptLoading ? <Spinner /> : 'Gerar Prompt Automaticamente'}
          </button>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Clique no botão acima para gerar um prompt, ou escreva sua própria descrição da cena aqui..."
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 focus:outline-none transition duration-300 resize-none h-32"
            disabled={isAnyLoading}
          />
        </div>
      </div>
      
      {promptError && (
        <div className="text-center p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-300 w-full max-w-2xl">
          <p>{promptError}</p>
        </div>
      )}

      {/* Image Generator Section */}
      <div className="w-full max-w-2xl bg-slate-800/60 rounded-xl p-6 shadow-2xl shadow-cyan-500/10 border border-slate-700">
         <h2 className="text-xl font-semibold text-center text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 mb-4">
            Passo 2: Gere a Imagem
        </h2>
        <div className="mb-4">
            <p className="block text-sm font-medium text-gray-400 mb-2 text-center">Formato da Imagem</p>
            <div className="flex items-center justify-center gap-4">
                <div>
                    <input 
                        type="radio" 
                        id="aspect-9-16" 
                        name="aspectRatio" 
                        value="9:16" 
                        checked={aspectRatio === '9:16'} 
                        onChange={() => setAspectRatio('9:16')}
                        disabled={isAnyLoading}
                        className="sr-only peer"
                    />
                    <label 
                        htmlFor="aspect-9-16"
                        className="flex flex-col items-center text-sm gap-1 justify-center px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg cursor-pointer peer-checked:border-cyan-500 peer-checked:ring-2 peer-checked:ring-cyan-500/50 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed transition-all"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5"><rect x="7" y="3" width="10" height="18" rx="1" stroke="currentColor" strokeWidth="2"/></svg>
                        <span>Vertical</span>
                    </label>
                </div>
                <div>
                    <input 
                        type="radio" 
                        id="aspect-16-9" 
                        name="aspectRatio" 
                        value="16:9" 
                        checked={aspectRatio === '16:9'} 
                        onChange={() => setAspectRatio('16:9')}
                        disabled={isAnyLoading}
                        className="sr-only peer"
                    />
                    <label 
                        htmlFor="aspect-16-9"
                        className="flex flex-col items-center text-sm gap-1 justify-center px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg cursor-pointer peer-checked:border-cyan-500 peer-checked:ring-2 peer-checked:ring-cyan-500/50 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed transition-all"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5"><rect x="3" y="7" width="18" height="10" rx="1" stroke="currentColor" strokeWidth="2"/></svg>
                        <span>Horizontal</span>
                    </label>
                </div>
            </div>
        </div>
        <button
          onClick={handleGenerateImage}
          disabled={!promptText.trim() || isAnyLoading || isSequenceActive}
          className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold py-3 px-6 rounded-lg hover:from-cyan-600 hover:to-blue-700 transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center w-full"
        >
          {isImageLoading ? <Spinner /> : 'Gerar Imagem'}
        </button>
      </div>

      {isImageLoading && !generatedImage && (
        <div className="text-center p-4 bg-slate-800 rounded-lg">
          <p className="text-cyan-400">Gerando a imagem... Isso pode levar alguns instantes.</p>
        </div>
      )}

      {imageError && (
        <div className="text-center p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-300 w-full max-w-2xl">
          <p>{imageError}</p>
        </div>
      )}

      {generatedImage && (
        <div className={`w-full flex flex-col items-center gap-4 ${aspectRatio === '9:16' ? 'max-w-md' : 'max-w-2xl'}`}>
           <div className="w-full relative group">
              <img
                src={generatedImage}
                alt={`Cena de ${bibleReference}`}
                className="rounded-xl shadow-lg shadow-black/50 border-2 border-slate-700 w-full"
              />
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl">
                 <button
                    onClick={() => handleDownload(generatedImage, 'scene')}
                    className="bg-white/20 backdrop-blur-sm text-white font-bold py-3 px-5 rounded-lg hover:bg-white/30 transition duration-300 flex items-center gap-2"
                  >
                    <DownloadIcon />
                    Baixar Imagem
                  </button>
              </div>
           </div>
           
           {isSequenceActive && (
             <div className="w-full mt-2">
               <button
                 onClick={handleGenerateNextVerse}
                 disabled={isAnyLoading}
                 className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold py-3 px-6 rounded-lg hover:from-green-600 hover:to-emerald-700 transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
               >
                 {isImageLoading ? <Spinner /> : `Gerar Próximo Versículo (${getNextVerseRef()})`}
               </button>
             </div>
           )}
        </div>
      )}
      
      <hr className="w-full max-w-2xl border-slate-700 my-4" />

      {/* Audio Generator Section */}
      <div className="w-full max-w-2xl bg-slate-800/60 rounded-xl p-6 shadow-2xl shadow-blue-500/10 border border-slate-700">
        <div className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500 mb-2">
                Gerador de Narração
            </h2>
            <div className="flex flex-col gap-2">
                <label htmlFor="narration-text" className="block text-sm font-medium text-gray-400">Texto para Narrar</label>
                <textarea
                    id="narration-text"
                    value={textForNarration}
                    onChange={(e) => setTextForNarration(e.target.value)}
                    placeholder="Clique em 'Buscar Texto' para preencher automaticamente, ou cole o texto aqui."
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none transition duration-300 resize-none h-28"
                    disabled={isAnyLoading}
                />
                <button
                    onClick={handleFetchVerseText}
                    disabled={!bibleReference.trim() || isAnyLoading}
                    className="bg-gradient-to-r from-slate-600 to-slate-700 text-white font-bold py-2 px-4 rounded-lg hover:from-slate-700 hover:to-slate-800 transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center w-full"
                >
                    {isFetchingVerse ? <Spinner /> : 'Buscar Texto do Versículo'}
                </button>
            </div>
            <p className="text-center text-gray-400 text-sm my-2">
                Escolha o idioma e a voz para a narração.
            </p>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div>
                    <label htmlFor="language-select" className="block text-sm font-medium text-gray-400 mb-1">Idioma</label>
                    <select
                        id="language-select"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        disabled={isAnyLoading}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none transition duration-300"
                    >
                        {Object.entries(LANGUAGES).map(([code, name]) => (
                            <option key={code} value={code}>{name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-col justify-end">
                     <p className="block text-sm font-medium text-gray-400 mb-1">Tipo de Voz</p>
                    <div className="flex items-center justify-around gap-4 bg-slate-900 border border-slate-600 rounded-lg p-2 h-full">
                        {['adulta', 'infantil'].map((type) => (
                            <label key={type} className="flex items-center gap-2 cursor-pointer text-base">
                                <input
                                    type="radio"
                                    name="voiceType"
                                    value={type}
                                    checked={voiceType === type}
                                    onChange={(e) => setVoiceType(e.target.value)}
                                    className="form-radio h-4 w-4 text-cyan-500 bg-slate-700 border-slate-600 focus:ring-cyan-500"
                                    disabled={isAnyLoading}
                                />
                                <span className="capitalize">{type === 'adulta' ? 'Adulta' : 'Infantil'}</span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>
            <button
                onClick={handleGenerateAudioClick}
                disabled={!textForNarration.trim() || isAnyLoading}
                className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold py-3 px-6 rounded-lg hover:from-blue-600 hover:to-indigo-700 transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center w-full mt-4"
            >
                {isAudioLoading ? <Spinner /> : 'Gerar Áudio'}
            </button>
        </div>
      </div>

      {isAudioLoading && (
        <div className="text-center p-4 bg-slate-800 rounded-lg w-full max-w-2xl">
          <p className="text-blue-400">
            {voiceType === 'adulta' 
              ? 'Gerando narração... a voz adulta pode levar um pouco mais de tempo.' 
              : 'Gerando narração...'}
          </p>
        </div>
      )}

      {audioError && (
        <div className="text-center p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-300 w-full max-w-2xl">
          <p>{audioError}</p>
        </div>
      )}

      {generatedAudioUrl && (
        <div className="w-full max-w-md mt-4 flex flex-col gap-4">
           {narratedText && (
                <div className="bg-slate-900/70 p-4 rounded-lg border border-slate-700">
                    <p className="text-gray-300 italic text-center">"{narratedText}"</p>
                </div>
            )}
           <audio controls src={generatedAudioUrl} className="w-full">
              Seu navegador não suporta o elemento de áudio.
           </audio>
        </div>
      )}
    </div>
  );
};

export default ImageGenerator;