revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (business_name, phone) on public.profiles to authenticated;
