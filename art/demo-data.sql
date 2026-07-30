--
-- Demo database behind the README screenshots.
--
-- Entirely fictional: no real company, person, or address appears here. It
-- exists so the screenshots show a believable schema — primary keys, foreign
-- keys, indexes, a nullable date, money, and enough rows for the grid to look
-- like a working database — without exposing anyone's data.
--
--   createdb db_console_demo
--   psql -d db_console_demo -f art/demo-data.sql
--

drop schema if exists public cascade;
create schema public;

-- ---------------------------------------------------------------- tables ---

create table customers
(
    id           bigserial primary key,
    name         varchar(255)   not null,
    email        varchar(255)   not null unique,
    country      varchar(2)     not null,
    credit_limit numeric(12, 2) not null default 0,
    is_active    boolean        not null default true,
    created_at   timestamp(0)   not null
);

create table products
(
    id         bigserial primary key,
    sku        varchar(32)    not null unique,
    name       varchar(255)   not null,
    category   varchar(64)    not null,
    unit_price numeric(10, 2) not null,
    stock      integer        not null default 0,
    created_at timestamp(0)   not null
);

create table orders
(
    id          bigserial primary key,
    customer_id bigint         not null references customers (id) on delete cascade,
    reference   varchar(24)    not null unique,
    status      varchar(16)    not null,
    currency    varchar(3)     not null default 'USD',
    total       numeric(12, 2) not null default 0,
    placed_at   timestamp(0)   not null,
    notes       text
);

create index orders_customer_id_index on orders (customer_id);
create index orders_status_index on orders (status);

create table order_items
(
    id         bigserial primary key,
    order_id   bigint         not null references orders (id) on delete cascade,
    product_id bigint         not null references products (id) on delete restrict,
    quantity   integer        not null,
    unit_price numeric(10, 2) not null
);

create index order_items_order_id_index on order_items (order_id);

create table invoices
(
    id        bigserial primary key,
    order_id  bigint         not null references orders (id) on delete cascade,
    number    varchar(24)    not null unique,
    issued_on date           not null,
    due_on    date           not null,
    paid_at   timestamp(0),
    amount    numeric(12, 2) not null
);

create table shipments
(
    id           bigserial primary key,
    order_id     bigint       not null references orders (id) on delete cascade,
    carrier      varchar(64)  not null,
    tracking_no  varchar(32)  not null,
    dispatched_at timestamp(0),
    delivered_at timestamp(0)
);

-- ------------------------------------------------------------------ data ---

insert into customers (name, email, country, credit_limit, is_active, created_at)
select c.name,
       c.slug || '@example.com',
       c.country,
       round((5000 + (c.i * 1750))::numeric, 2),
       c.i % 9 <> 0,
       timestamp '2025-03-04 08:15:00' + (c.i * 9 || ' days')::interval
from (values (1, 'Northwind Traders', 'northwind', 'US'),
             (2, 'Alpine Supply Co.', 'alpine-supply', 'CH'),
             (3, 'Harbor Logistics', 'harbor-logistics', 'NL'),
             (4, 'Vertex Materials', 'vertex-materials', 'US'),
             (5, 'Blue Ridge Foods', 'blue-ridge', 'CA'),
             (6, 'Kestrel Components', 'kestrel', 'GB'),
             (7, 'Lumen Industrial', 'lumen-industrial', 'DE'),
             (8, 'Pine & Co.', 'pine-co', 'SE'),
             (9, 'Sable Freight', 'sable-freight', 'FR'),
             (10, 'Orchard Wholesale', 'orchard', 'AU'),
             (11, 'Ironwood Partners', 'ironwood', 'US'),
             (12, 'Cedar Point Ltd.', 'cedar-point', 'GB'),
             (13, 'Marlow Distribution', 'marlow', 'IE'),
             (14, 'Quill Office Group', 'quill-office', 'US'),
             (15, 'Ridgeway Metals', 'ridgeway', 'ZA'),
             (16, 'Silverbrook Trading', 'silverbrook', 'SG'),
             (17, 'Tidewater Imports', 'tidewater', 'NZ'),
             (18, 'Umbra Systems', 'umbra-systems', 'PL'),
             (19, 'Vandergraaf BV', 'vandergraaf', 'NL'),
             (20, 'Westfield Retail', 'westfield', 'US'),
             (21, 'Yarrow Organics', 'yarrow', 'CA'),
             (22, 'Zephyr Air Cargo', 'zephyr-cargo', 'AE'),
             (23, 'Ashford Chemicals', 'ashford', 'GB'),
             (24, 'Brightline Tools', 'brightline', 'DK')) as c(i, name, slug, country);

insert into products (sku, name, category, unit_price, stock, created_at)
select 'SKU-' || lpad(i::text, 4, '0'),
       (array ['Hex Bolt M8','Hex Bolt M12','Flange Nut M10','Washer Set 200pc','Socket Cap Screw M6',
           'Torque Wrench 1/2"','Impact Driver 18V','Angle Grinder 125mm','Bench Vice 150mm','Digital Caliper',
           'Stretch Wrap 500mm','Carton Tape 48mm','Pallet Corner Guard','Bubble Wrap 100m','Strapping Band 16mm',
           'Safety Goggles','Nitrile Gloves L','Ear Defenders','Hi-Vis Vest XL','Steel Toe Boots 43',
           'Cable Tie 300mm','Junction Box IP65','Terminal Block 12-way','Cable Gland M20','Heat Shrink Kit',
           'Epoxy Adhesive 50ml','Threadlock Blue','Silicone Sealant','Contact Cement 1L','Anti-Seize Paste'])[i],
       (array ['Fasteners','Tooling','Packaging','Safety','Electrical','Adhesives'])[1 + ((i - 1) / 5)],
       round((6.40 + (i * 7.35))::numeric, 2),
       (i * 37) % 480,
       timestamp '2025-08-01 09:00:00' + (i * 3 || ' days')::interval
from generate_series(1, 30) as i;

insert into orders (customer_id, reference, status, currency, placed_at, notes)
select 1 + ((i * 5) % 24),
       'SO-' || (2400 + i)::text,
       (array ['draft','confirmed','picking','shipped','invoiced','paid'])[1 + (i % 6)],
       (array ['USD','USD','EUR','GBP'])[1 + (i % 4)],
       timestamp '2026-01-06 10:20:00' + (i * 4 || ' days')::interval + (i * 17 || ' minutes')::interval,
       case when i % 7 = 0 then 'Customer asked for a split delivery.' end
from generate_series(1, 40) as i;

insert into order_items (order_id, product_id, quantity, unit_price)
select o.id,
       p.id,
       1 + ((o.id * k) % 12),
       p.unit_price
from orders o
         cross join lateral (select k from generate_series(1, 3) as k where (o.id + k) % 4 <> 0) as picks(k)
         join products p on p.id = 1 + ((o.id * 3 + picks.k * 7) % 30);

update orders o
set total = coalesce((select round(sum(i.quantity * i.unit_price), 2)
                      from order_items i
                      where i.order_id = o.id), 0);

insert into invoices (order_id, number, issued_on, due_on, paid_at, amount)
select o.id,
       'INV-' || (9100 + o.id)::text,
       (o.placed_at + interval '2 days')::date,
       (o.placed_at + interval '32 days')::date,
       case when o.status = 'paid' then o.placed_at + interval '21 days' end,
       o.total
from orders o
where o.status in ('invoiced', 'paid');

insert into shipments (order_id, carrier, tracking_no, dispatched_at, delivered_at)
select o.id,
       (array ['DHL Express','FedEx Priority','UPS Standard','Maersk Line'])[1 + (o.id % 4)],
       'TRK' || lpad(((o.id * 7919) % 100000)::text, 8, '0'),
       o.placed_at + interval '3 days',
       case when o.status in ('invoiced', 'paid') then o.placed_at + interval '6 days' end
from orders o
where o.status in ('shipped', 'invoiced', 'paid');

analyze customers, products, orders, order_items, invoices, shipments;
