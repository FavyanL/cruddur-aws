from lib.db import pool

class CreateMessage:
  def run(message, user_sender_handle, user_receiver_handle):
    model = {
      'errors': None,
      'data': None
    }
    if user_sender_handle == None or len(user_sender_handle) < 1:
      model['errors'] = ['user_sender_handle_blank']

    if user_receiver_handle == None or len(user_receiver_handle) < 1:
      model['errors'] = ['user_receiver_handle_blank']

    if message == None or len(message) < 1:
      model['errors'] = ['message_blank']
    elif len(message) > 1024:
      model['errors'] = ['message_exceed_max_chars']

    if model['errors']:
      # return what we provided
      model['data'] = {
        'handle':  user_sender_handle,
        'message': message
      }
    else:
      message_uuid = CreateMessage.create_message(
        sender_handle=user_sender_handle,
        receiver_handle=user_receiver_handle,
        message=message,
      )
      model['data'] = CreateMessage.query_message(message_uuid)
    return model

  # Insert a new message and return its UUID.
  def create_message(sender_handle, receiver_handle, message):
    sql = """
      INSERT INTO public.messages (
        user_sender_uuid,
        user_receiver_uuid,
        message
      )
      VALUES (
        (SELECT uuid FROM public.users WHERE users.handle = %(sender)s LIMIT 1),
        (SELECT uuid FROM public.users WHERE users.handle = %(receiver)s LIMIT 1),
        %(message)s
      )
      RETURNING uuid;
    """
    with pool.connection() as conn:
      with conn.cursor() as cur:
        cur.execute(sql, {
          'sender': sender_handle,
          'receiver': receiver_handle,
          'message': message,
        })
        return cur.fetchone()[0]

  # Read the just-created message back joined with the sender's display info.
  def query_message(message_uuid):
    sql = """
      SELECT
        messages.uuid,
        sender.display_name,
        sender.handle,
        messages.message,
        messages.created_at
      FROM public.messages
      INNER JOIN public.users sender ON sender.uuid = messages.user_sender_uuid
      WHERE messages.uuid = %(uuid)s;
    """
    with pool.connection() as conn:
      with conn.cursor() as cur:
        cur.execute(sql, {'uuid': message_uuid})
        row = cur.fetchone()
        if row is None:
          return None
        return {
          'uuid': str(row[0]),
          'display_name': row[1],
          'handle': row[2],
          'message': row[3],
          'created_at': row[4].isoformat() if row[4] else None,
        }