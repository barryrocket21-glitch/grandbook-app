-- Prospective, bounded contact state; no changes to order/financial state.
BEGIN;
CREATE TABLE public.cs_shipment_contacts (
 organization_id bigint NOT NULL REFERENCES public.organizations(id),
 order_number text NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 wa_opened_at timestamptz,
 contacted_at timestamptz,
 PRIMARY KEY (organization_id, order_number, actor_id)
);
ALTER TABLE public.cs_shipment_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cs_shipment_contacts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cs_shipment_contacts TO authenticated;
CREATE POLICY own_active_cs_contact ON public.cs_shipment_contacts FOR SELECT TO authenticated
USING (actor_id=(select auth.uid()) AND EXISTS (
 SELECT 1 FROM public.profiles p WHERE p.id=(select auth.uid()) AND p.active AND p.role='cs' AND p.organization_id=cs_shipment_contacts.organization_id
));
CREATE FUNCTION public.record_my_cs_contact(p_source text,p_order_id bigint,p_action text)
RETURNS SETOF public.cs_shipment_contacts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u uuid:=auth.uid(); org bigint; n text; ref text;
BEGIN
 SELECT organization_id,full_name INTO org,n FROM profiles WHERE id=u AND active AND role='cs';
 IF org IS NULL THEN RAISE EXCEPTION 'forbidden_cs_only'; END IF;
 IF p_source NOT IN ('draft','final') OR p_source IS NULL OR p_action IS NULL OR p_action NOT IN ('wa_opened','contacted','clear_contacted') THEN RAISE EXCEPTION 'invalid_contact_action'; END IF;
 SELECT o.order_number INTO ref FROM (
  SELECT organization_id,id,order_number,cs_id,cs_name FROM orders_draft WHERE p_source='draft' AND id=p_order_id
  UNION ALL SELECT organization_id,id,order_number,cs_id,cs_name FROM orders WHERE p_source='final' AND id=p_order_id
 )o WHERE o.organization_id=org AND (
 (NULLIF(trim(n),'') IS NOT NULL AND lower(trim(coalesce(o.cs_name,'')))=lower(trim(n)))
 OR (coalesce(trim(o.cs_name),'')='' AND o.cs_id=u));
 IF ref IS NULL THEN RAISE EXCEPTION 'shipment_not_owned'; END IF;
 RETURN QUERY INSERT INTO cs_shipment_contacts AS c(organization_id,order_number,actor_id,wa_opened_at,contacted_at)
 VALUES(org,ref,u,CASE WHEN p_action='wa_opened' THEN now() END,CASE WHEN p_action='contacted' THEN now() END)
 ON CONFLICT (organization_id,order_number,actor_id) DO UPDATE SET
 wa_opened_at=CASE WHEN p_action='wa_opened' THEN now() ELSE c.wa_opened_at END,
 contacted_at=CASE WHEN p_action='contacted' THEN now() WHEN p_action='clear_contacted' THEN NULL ELSE c.contacted_at END
 RETURNING c.*;
END $$;
REVOKE ALL ON FUNCTION public.record_my_cs_contact(text,bigint,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_my_cs_contact(text,bigint,text) TO authenticated;
COMMIT;
