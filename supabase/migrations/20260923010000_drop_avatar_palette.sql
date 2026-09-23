-- Kit palette ids are unused. Color comes from part and set chroma.

alter table public.avatar_owned
  drop column if exists palette;
