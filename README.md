# TwinPix Cloud

Encontra fotos e vídeos repetidos no **OneDrive** e deixa você revisar **um grupo por vez,
lado a lado**, movendo para a lixeira só o que escolher.

- Compara várias pastas (e todas as subpastas) de uma vez.
- Nada é baixado: a análise usa só as informações dos arquivos.
- Nada é apagado de vez: tudo vai para a **lixeira do OneDrive**, e dá para desfazer.
- Nunca deixa excluir todas as cópias de um grupo.

> Versão atual: cópias **idênticas**. Prováveis cópias e reconciliação de pastas vêm a seguir.

## Experimentar sem conectar (modo demonstração)

Requer Node 22 ou mais novo.

    npm install
    npm run demo

O navegador abre com arquivos fictícios. Nada acontece no seu OneDrive.

## Usar com o seu OneDrive

1. Acesse https://entra.microsoft.com com a sua conta Microsoft.
   Com conta pessoal, pode ser preciso antes criar uma conta Azure gratuita em
   https://signup.azure.com (ela cria um "Diretório padrão"; pede um cartão apenas para
   verificar a identidade). Se aparecer o erro "A conta de usuário selecionada não existe no
   locatário 'Microsoft Services'", é esse o caminho; se o portal insistir no erro, use uma
   janela privada do navegador.
2. Vá em **Registros de aplicativo → Novo registro**:
   - Nome: `TwinPix Cloud` (ou o que quiser);
   - Tipos de conta: **Somente contas pessoais da Microsoft**;
   - URI de redirecionamento: plataforma **Cliente público/nativo (móvel e área de trabalho)**,
     endereço `http://localhost:4317/api/auth/callback`.
3. Em **Permissões de API → Adicionar permissão → Microsoft Graph → Permissões delegadas**,
   marque `Files.ReadWrite` (não precisa da `.All`) e `offline_access`.
4. Copie o **ID do aplicativo (cliente)**.
5. Na pasta do projeto, copie `.env.example` para `.env` e preencha `TWINPIX_CLIENT_ID=`.
6. Rode:

       npm install
       npm run build
       npm start

O endereço com o token de sessão aparece no terminal e o navegador abre sozinho.

## Desenvolvimento

    npm run dev        # API em 127.0.0.1:4317 e interface em http://localhost:5173
    npm test           # testes da API e da interface
    npm run typecheck

Em modo dev, abra `http://localhost:5173/#token=dev-local`.

## Como criar o seu provedor

O app fala com a nuvem só pela interface `CloudProvider`
(`apps/api/src/cloud/cloud-provider.ts`). Para outra nuvem, implemente essa interface
(veja `onedrive/onedrive-provider.ts` e `fake-cloud-provider.ts` como exemplos) e registre a
implementação em `apps/api/src/cloud/cloud.module.ts`.

## Segurança

- O servidor escuta só em `127.0.0.1` e exige um token de sessão em toda chamada.
- O token da Microsoft fica em `~/.twinpix-cloud/msal-cache.json`, legível só pelo seu usuário.
- Nenhum segredo vai para o repositório: o Client ID fica no `.env`.

## Licença e contribuições

MIT. Este projeto **não aceita pull requests**; faça um fork se quiser adaptar. Veja `CONTRIBUTING.md`.
