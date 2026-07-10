from lib.db import pool, query_wrap_array

class Messages:
  def run(cognito_user_id, user_receiver_handle):
    model = {
      'errors': None,
      'data': None
    }

    if cognito_user_id == None or len(cognito_user_id) < 1:
      model['errors'] = ['cognito_user_id_blank']
    if user_receiver_handle == None or len(user_receiver_handle) < 1:
      model['errors'] = ['user_receiver_handle_blank']

    if model['errors']:
      return model

    # All messages between sender and receiver (in either direction), oldest first.
    sql = query_wrap_array("""
      SELECT
        messages.uuid,
        sender.display_name,
        sender.handle,
        messages.message,
        messages.created_at
      FROM public.messages
      INNER JOIN public.users sender ON sender.uuid = messages.user_sender_uuid
      INNER JOIN public.users me    ON me.cognito_user_id = %(cognito_user_id)s
      INNER JOIN public.users other ON other.handle       = %(receiver_handle)s
      WHERE (messages.user_sender_uuid = me.uuid    AND messages.user_receiver_uuid = other.uuid)
         OR (messages.user_sender_uuid = other.uuid AND messages.user_receiver_uuid = me.uuid)
      ORDER BY messages.created_at ASC
    """)
    with pool.connection() as conn:
      with conn.cursor() as cur:
        cur.execute(sql, {
          'cognito_user_id': cognito_user_id,
          'receiver_handle': user_receiver_handle,
        })
        row = cur.fetchone()
        model['data'] = row[0] if row and row[0] else []
    return model