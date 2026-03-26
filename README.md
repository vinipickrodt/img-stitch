# 🖼️ img-stitch

Junte múltiplos screenshots em uma única imagem contínua — diretamente no browser, sem upload para servidor.

## Como funciona

O app usa um algoritmo de **template matching por pixels** para encontrar a região de sobreposição entre imagens consecutivas e fazer a costura automaticamente. Todo o processamento é feito no cliente via Canvas API.

## Funcionalidades

- 📤 Upload de múltiplas imagens
- 🔀 Reordenação das imagens (arrastar cima/baixo)
- 🔍 Matching automático com feedback de erro por par
- ⚙️ Configurações ajustáveis:
  - Tolerância a diferenças de cor
  - Tamanho da amostra de busca
  - Ignorar topo/rodapé (útil para barra de status e navegação)
- 💾 Download da imagem final em PNG

## Stack

- [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [lucide-react](https://lucide.dev/)

## Rodando localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:5173`.

## Rodando com Docker

```bash
docker build -t img-stitch .
docker run -p 8080:80 img-stitch
```

Acesse `http://localhost:8080`.
