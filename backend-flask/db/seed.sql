-- this file was manually created
INSERT INTO public.users (display_name, handle, cognito_user_id)
VALUES
    ('Favyan', 'favyan', 'MOCK'),
    ('Andrew Brown', 'andrewbrown', 'MOCK'),
    ('Hugo L', 'hugol', 'MOCK'),
    ('Andrew S', 'shark', 'MOCK');

INSERT INTO public.activities (user_uuid, message, expires_at)
VALUES
    (
        (SELECT uuid from public.users WHERE users.handle = 'hugol' LIMIT 1),
        'This was imported as seed data!',
        current_timestamp + interval '10 day'
    );

-- Seed a few messages so the Messages page has conversations to show.
INSERT INTO public.messages (user_sender_uuid, user_receiver_uuid, message, created_at)
VALUES
    (
        (SELECT uuid FROM public.users WHERE users.handle = 'hugol' LIMIT 1),
        (SELECT uuid FROM public.users WHERE users.handle = 'favyan' LIMIT 1),
        'Hey Favyan! Just getting started with the bootcamp.',
        current_timestamp - interval '2 hour'
    ),
    (
        (SELECT uuid FROM public.users WHERE users.handle = 'favyan' LIMIT 1),
        (SELECT uuid FROM public.users WHERE users.handle = 'hugol' LIMIT 1),
        'Welcome! Let me know if you have questions.',
        current_timestamp - interval '1 hour'
    ),
    (
        (SELECT uuid FROM public.users WHERE users.handle = 'shark' LIMIT 1),
        (SELECT uuid FROM public.users WHERE users.handle = 'favyan' LIMIT 1),
        'When does the next stream go live?',
        current_timestamp - interval '30 minute'
    )