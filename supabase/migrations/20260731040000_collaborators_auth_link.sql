-- PRATA - Login (Supabase Auth) + vínculo de colaboradores com usuário de acesso
-- As credenciais em si (e-mail/senha) ficam no auth.users nativo do Supabase,
-- gerenciado via Admin API (api/create-collaborator.js) - nunca numa tabela
-- própria. Aqui só guardamos a referência de qual auth.users corresponde a
-- qual linha da tabela collaborators (colaboradores antigos, criados antes
-- de existir login, ficam com auth_user_id nulo — sem acesso ao PRATA ainda).

alter table public.collaborators add column if not exists auth_user_id uuid;
