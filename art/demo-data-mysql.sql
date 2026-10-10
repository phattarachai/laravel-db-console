--
-- The demo database behind the README screenshots, for MySQL 8 and MariaDB.
-- The same fictional rows as demo-data.sql (the Postgres version).
--
-- Entirely fictional: no real company, person, or address appears here. It
-- exists so the screenshots show a believable schema — primary keys, foreign
-- keys, indexes, a nullable date, money, a boolean and enough rows for the grid
-- to look like a working database — without exposing anyone's data.
--
--   mysql -e 'create database db_console_demo'
--   mysql db_console_demo < art/demo-data-mysql.sql
--

set foreign_key_checks = 0;
drop table if exists shipments, invoices, order_items, orders, products, customers;
set foreign_key_checks = 1;

-- ---------------------------------------------------------------- tables ---

create table customers
(
    id           bigint unsigned auto_increment primary key,
    name         varchar(255)   not null,
    email        varchar(255)   not null unique,
    country      varchar(2)     not null,
    credit_limit decimal(12, 2) not null default 0,
    is_active    boolean        not null default true,
    created_at   timestamp      not null
);

create table products
(
    id         bigint unsigned auto_increment primary key,
    sku        varchar(32)    not null unique,
    name       varchar(255)   not null,
    category   varchar(64)    not null,
    unit_price decimal(10, 2) not null,
    stock      int            not null default 0,
    created_at timestamp      not null
);

create table orders
(
    id          bigint unsigned auto_increment primary key,
    customer_id bigint unsigned not null,
    reference   varchar(24)     not null unique,
    status      varchar(16)     not null,
    currency    varchar(3)      not null default 'USD',
    total       decimal(12, 2)  not null default 0,
    placed_at   timestamp       not null,
    notes       text,
    index orders_status_index (status),
    constraint orders_customer_id_foreign foreign key (customer_id) references customers (id) on delete cascade
);

create table order_items
(
    id         bigint unsigned auto_increment primary key,
    order_id   bigint unsigned not null,
    product_id bigint unsigned not null,
    quantity   int             not null,
    unit_price decimal(10, 2)  not null,
    constraint order_items_order_id_foreign foreign key (order_id) references orders (id) on delete cascade,
    constraint order_items_product_id_foreign foreign key (product_id) references products (id) on delete restrict
);

create table invoices
(
    id        bigint unsigned auto_increment primary key,
    order_id  bigint unsigned not null,
    number    varchar(24)     not null unique,
    issued_on date            not null,
    due_on    date            not null,
    paid_at   timestamp       null,
    amount    decimal(12, 2)  not null,
    constraint invoices_order_id_foreign foreign key (order_id) references orders (id) on delete cascade
);

create table shipments
(
    id            bigint unsigned auto_increment primary key,
    order_id      bigint unsigned not null,
    carrier       varchar(64)     not null,
    tracking_no   varchar(32)     not null,
    dispatched_at timestamp       null,
    delivered_at  timestamp       null,
    constraint shipments_order_id_foreign foreign key (order_id) references orders (id) on delete cascade
);

-- ------------------------------------------------------------------ data ---

insert into customers (name, email, country, credit_limit, is_active, created_at)
select c.name,
       concat(c.slug, '@example.com'),
       c.country,
       round(5000 + (c.i * 1750), 2),
       c.i % 9 <> 0,
       timestamp '2025-03-04 08:15:00' + interval (c.i * 9) day
from (select 1 as i, 'Northwind Traders' as name, 'northwind' as slug, 'US' as country
      union all select 2, 'Alpine Supply Co.', 'alpine-supply', 'CH'
      union all select 3, 'Harbor Logistics', 'harbor-logistics', 'NL'
      union all select 4, 'Vertex Materials', 'vertex-materials', 'US'
      union all select 5, 'Blue Ridge Foods', 'blue-ridge', 'CA'
      union all select 6, 'Kestrel Components', 'kestrel', 'GB'
      union all select 7, 'Lumen Industrial', 'lumen-industrial', 'DE'
      union all select 8, 'Pine & Co.', 'pine-co', 'SE'
      union all select 9, 'Sable Freight', 'sable-freight', 'FR'
      union all select 10, 'Orchard Wholesale', 'orchard', 'AU'
      union all select 11, 'Ironwood Partners', 'ironwood', 'US'
      union all select 12, 'Cedar Point Ltd.', 'cedar-point', 'GB'
      union all select 13, 'Marlow Distribution', 'marlow', 'IE'
      union all select 14, 'Quill Office Group', 'quill-office', 'US'
      union all select 15, 'Ridgeway Metals', 'ridgeway', 'ZA'
      union all select 16, 'Silverbrook Trading', 'silverbrook', 'SG'
      union all select 17, 'Tidewater Imports', 'tidewater', 'NZ'
      union all select 18, 'Umbra Systems', 'umbra-systems', 'PL'
      union all select 19, 'Vandergraaf BV', 'vandergraaf', 'NL'
      union all select 20, 'Westfield Retail', 'westfield', 'US'
      union all select 21, 'Yarrow Organics', 'yarrow', 'CA'
      union all select 22, 'Zephyr Air Cargo', 'zephyr-cargo', 'AE'
      union all select 23, 'Ashford Chemicals', 'ashford', 'GB'
      union all select 24, 'Brightline Tools', 'brightline', 'DK') as c
order by c.i;

insert into products (sku, name, category, unit_price, stock, created_at)
with recursive seq (i) as (select 1 union all select i + 1 from seq where i < 30)
select concat('SKU-', lpad(i, 4, '0')),
       elt(i, 'Hex Bolt M8', 'Hex Bolt M12', 'Flange Nut M10', 'Washer Set 200pc', 'Socket Cap Screw M6',
           'Torque Wrench 1/2"', 'Impact Driver 18V', 'Angle Grinder 125mm', 'Bench Vice 150mm', 'Digital Caliper',
           'Stretch Wrap 500mm', 'Carton Tape 48mm', 'Pallet Corner Guard', 'Bubble Wrap 100m', 'Strapping Band 16mm',
           'Safety Goggles', 'Nitrile Gloves L', 'Ear Defenders', 'Hi-Vis Vest XL', 'Steel Toe Boots 43',
           'Cable Tie 300mm', 'Junction Box IP65', 'Terminal Block 12-way', 'Cable Gland M20', 'Heat Shrink Kit',
           'Epoxy Adhesive 50ml', 'Threadlock Blue', 'Silicone Sealant', 'Contact Cement 1L', 'Anti-Seize Paste'),
       elt(1 + ((i - 1) div 5), 'Fasteners', 'Tooling', 'Packaging', 'Safety', 'Electrical', 'Adhesives'),
       round(6.40 + (i * 7.35), 2),
       (i * 37) % 480,
       timestamp '2025-08-01 09:00:00' + interval (i * 3) day
from seq
order by i;

insert into orders (customer_id, reference, status, currency, placed_at, notes)
with recursive seq (i) as (select 1 union all select i + 1 from seq where i < 40)
select 1 + ((i * 5) % 24),
       concat('SO-', 2400 + i),
       elt(1 + (i % 6), 'draft', 'confirmed', 'picking', 'shipped', 'invoiced', 'paid'),
       elt(1 + (i % 4), 'USD', 'USD', 'EUR', 'GBP'),
       timestamp '2026-01-06 10:20:00' + interval (i * 4) day + interval (i * 17) minute,
       case when i % 7 = 0 then 'Customer asked for a split delivery.' end
from seq
order by i;

insert into order_items (order_id, product_id, quantity, unit_price)
select o.id,
       p.id,
       1 + ((o.id * picks.k) % 12),
       p.unit_price
from orders o
         cross join (select 1 as k union all select 2 union all select 3) as picks
         join products p on p.id = 1 + ((o.id * 3 + picks.k * 7) % 30)
where (o.id + picks.k) % 4 <> 0
order by o.id, picks.k;

update orders o
set total = coalesce((select round(sum(i.quantity * i.unit_price), 2)
                      from order_items i
                      where i.order_id = o.id), 0);

insert into invoices (order_id, number, issued_on, due_on, paid_at, amount)
select o.id,
       concat('INV-', 9100 + o.id),
       date(o.placed_at + interval 2 day),
       date(o.placed_at + interval 32 day),
       case when o.status = 'paid' then o.placed_at + interval 21 day end,
       o.total
from orders o
where o.status in ('invoiced', 'paid')
order by o.id;

insert into shipments (order_id, carrier, tracking_no, dispatched_at, delivered_at)
select o.id,
       elt(1 + (o.id % 4), 'DHL Express', 'FedEx Priority', 'UPS Standard', 'Maersk Line'),
       concat('TRK', lpad((o.id * 7919) % 100000, 8, '0')),
       o.placed_at + interval 3 day,
       case when o.status in ('invoiced', 'paid') then o.placed_at + interval 6 day end
from orders o
where o.status in ('shipped', 'invoiced', 'paid')
order by o.id;

analyze table customers, products, orders, order_items, invoices, shipments;
